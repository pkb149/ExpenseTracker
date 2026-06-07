#!/usr/bin/env python3
"""
statement-poller.py — Fetch credit card / bank statement PDFs from Gmail,
extract transaction text, and post to expense-tracker for reconciliation.

Setup:
  pip install pikepdf pdfplumber google-api-python-client google-auth-oauthlib requests

Gmail credentials:
  1. Go to https://console.cloud.google.com → APIs & Services → Credentials
  2. Create OAuth 2.0 Client ID (Desktop app) → download JSON
  3. Save as the path in config "credentials_file"
  4. Run once: script will open browser for consent, saves token to "token_file"

Usage:
  python statement-poller.py                         # uses statement-config.json
  python statement-poller.py --config my.json
  python statement-poller.py --days 60               # look back 60 days
  python statement-poller.py --dry-run               # parse only, no API calls
"""

import argparse
import base64
import io
import json
import os
import sys
from datetime import datetime, timedelta

try:
    import pikepdf
    import pdfplumber
    import requests
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
except ImportError as e:
    sys.exit(f"Missing dependency: {e}\nRun: pip install pikepdf pdfplumber google-api-python-client google-auth-oauthlib requests")

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

STATEMENT_SEARCH_TERMS = [
    'credit card statement',
    'e-statement',
    'account statement',
    'monthly statement',
    'card statement',
    'estatement',
]

BANK_SENDERS = {
    'HDFC': ['hdfcbank.com'],
    'ICICI': ['icicibank.com'],
    'Axis': ['axisbank.com'],
    'SBI': ['sbi.co.in'],
    'Kotak': ['kotak.com'],
    'IDFC': ['idfcfirstbank.com'],
    'IndusInd': ['indusind.com'],
    'Yes Bank': ['yesbank.in'],
    'Paytm': ['paytm.com'],
    'AU Bank': ['aubank.in'],
}


def get_gmail_service(credentials_file: str, token_file: str):
    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_file):
                sys.exit(f"Gmail credentials not found: {credentials_file}\nDownload from Google Cloud Console → APIs & Services → Credentials")
            flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_file, 'w') as f:
            f.write(creds.to_json())
    return build('gmail', 'v1', credentials=creds)


def extract_pdf_text(pdf_bytes: bytes, password: str) -> str:
    try:
        with pikepdf.open(io.BytesIO(pdf_bytes), password=password) as pdf:
            out = io.BytesIO()
            pdf.save(out)
            out.seek(0)
            decrypted = out.read()
    except pikepdf.PasswordError:
        raise ValueError("Incorrect PDF password")
    except Exception:
        decrypted = pdf_bytes  # not encrypted

    pages = []
    with pdfplumber.open(io.BytesIO(decrypted)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)

    return '\n'.join(pages)


def detect_bank(subject: str, sender: str) -> str:
    combined = (subject + ' ' + sender).lower()
    for bank, domains in BANK_SENDERS.items():
        if any(d in combined for d in domains):
            return bank
    # Fallback: keyword match in subject
    for bank in BANK_SENDERS:
        if bank.lower() in combined:
            return bank
    return 'Unknown'


def iter_pdf_attachments(service, msg_id: str):
    """Yield (filename, bytes) for each PDF attachment."""
    msg = service.users().messages().get(userId='me', id=msg_id, format='full').execute()

    def flatten(parts):
        for p in parts:
            yield p
            if 'parts' in p:
                yield from flatten(p['parts'])

    for part in flatten(msg.get('payload', {}).get('parts', [])):
        fname = part.get('filename', '')
        if not fname.lower().endswith('.pdf'):
            continue
        att_id = part.get('body', {}).get('attachmentId')
        if att_id:
            att = service.users().messages().attachments().get(
                userId='me', messageId=msg_id, id=att_id
            ).execute()
            yield fname, base64.urlsafe_b64decode(att['data'])
        elif part.get('body', {}).get('data'):
            yield fname, base64.urlsafe_b64decode(part['body']['data'])


def post_to_api(api_url: str, token: str, bank: str, text: str, paid_by: str) -> dict:
    resp = requests.post(
        f'{api_url}/api/statement-ingest',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json={'bank': bank, 'text': text, 'paid_by': paid_by},
        timeout=90,
    )
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description='Fetch bank statement PDFs from Gmail and reconcile with expense tracker')
    parser.add_argument('--config', default=os.path.join(os.path.dirname(__file__), 'statement-config.json'))
    parser.add_argument('--days', type=int, default=37, help='Look back N days (default 37)')
    parser.add_argument('--dry-run', action='store_true', help='Extract and print text only, do not POST to API')
    args = parser.parse_args()

    if not os.path.exists(args.config):
        sys.exit(f"Config not found: {args.config}\nCopy statement-config.example.json and fill in your values.")

    with open(args.config) as f:
        cfg = json.load(f)

    service = get_gmail_service(
        cfg['credentials_file'],
        cfg.get('token_file', os.path.join(os.path.dirname(args.config), 'gmail-token.json'))
    )

    since = (datetime.now() - timedelta(days=args.days)).strftime('%Y/%m/%d')
    terms = ' OR '.join(f'"{t}"' for t in STATEMENT_SEARCH_TERMS)
    query = f'has:attachment filename:pdf after:{since} ({terms})'

    print(f"Searching Gmail: {query}\n")
    result = service.users().messages().list(userId='me', q=query, maxResults=100).execute()
    messages = result.get('messages', [])
    print(f"Found {len(messages)} matching emails\n")

    processed_ids: set = set(cfg.get('_processed_ids', []))
    newly_processed = []

    for meta in messages:
        msg_id = meta['id']
        if msg_id in processed_ids:
            continue

        # Fetch headers
        hdr_msg = service.users().messages().get(
            userId='me', id=msg_id, format='metadata',
            metadataHeaders=['Subject', 'From', 'Date']
        ).execute()
        headers = {h['name']: h['value'] for h in hdr_msg.get('payload', {}).get('headers', [])}
        subject = headers.get('Subject', '')
        sender = headers.get('From', '')
        date = headers.get('Date', '')

        bank = detect_bank(subject, sender)
        password = cfg.get('passwords', {}).get(bank, '')
        paid_by = cfg.get('default_paid_by', {}).get(bank, cfg.get('default_paid_by_fallback', 'Prashant'))

        pdf_found = False
        for fname, pdf_bytes in iter_pdf_attachments(service, msg_id):
            pdf_found = True
            print(f"  [{bank}] {subject[:60]}")
            print(f"  From: {sender} | Date: {date}")
            print(f"  File: {fname} ({len(pdf_bytes):,} bytes)")

            try:
                text = extract_pdf_text(pdf_bytes, password)
            except ValueError as e:
                print(f"  ERROR: {e} — set correct password in config for '{bank}'")
                continue
            except Exception as e:
                print(f"  ERROR extracting text: {e}")
                continue

            if not text.strip():
                print("  WARNING: no text extracted (scanned PDF?)")
                continue

            print(f"  Extracted {len(text):,} chars of text")

            if args.dry_run:
                print(f"  [dry-run] Skipping API call. First 500 chars:\n{text[:500]}\n")
                continue

            try:
                res = post_to_api(cfg['api_url'], cfg['ingest_token'], bank, text, paid_by)
                print(f"  Result: total={res.get('total')} matched={res.get('matched')} new_pending={res.get('new_pending')} skipped={res.get('skipped')}")
            except requests.HTTPError as e:
                print(f"  API error: {e.response.status_code} {e.response.text[:200]}")
                continue
            except Exception as e:
                print(f"  API error: {e}")
                continue

        if pdf_found:
            newly_processed.append(msg_id)
        print()

    # Persist processed IDs back to config to avoid reprocessing
    if newly_processed and not args.dry_run:
        cfg['_processed_ids'] = list(processed_ids | set(newly_processed))
        with open(args.config, 'w') as f:
            json.dump(cfg, f, indent=2)
        print(f"Marked {len(newly_processed)} emails as processed.")


if __name__ == '__main__':
    main()
