# ExpenseTracker — Project Context

## Stack
- Cloudflare Workers (Hono framework, TypeScript)
- Cloudflare D1 (SQLite) — binding: `DB`, database: `expense-tracker-db` (id: `72ceadd5-0c30-43eb-b107-0d7ca59455e8`)
- OpenRouter for LLM (parse & analyze endpoints)
- Deployed at: `https://expense-tracker.workers.dev`

## Source files
- `src/index.ts` — all routes and middleware
- `src/html.ts` — full frontend SPA (vanilla JS, no bundler)
- `schema.sql` — D1 schema
- `wrangler.jsonc` — Wrangler config

## Wrangler secrets (set via `wrangler secret put`)
| Secret | Purpose |
|--------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (`656350270076-t73elhid1h7st9gehup7093emaeeuln5.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (from downloaded JSON) |
| `SESSION_SECRET` | HMAC key for signing session cookies (random 32-byte hex) |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM calls |
| `INGEST_TOKEN` | Bearer token for `/api/ingest` (Gmail poller) |
| `LLM_MODEL` | Optional — defaults to `openai/gpt-oss-120b:free` |

## Google OAuth app
- Project: `paired-498510`
- OAuth consent screen: External, test users only
- Redirect URI: `https://expense-tracker.workers.dev/auth/callback`
- JS origin: `https://expense-tracker.workers.dev`
- Client secret JSON: `~/Downloads/client_secret_656350270076-*.json`

## Auth
- Google OAuth 2.0 (server-side code flow)
- Session: HMAC-SHA256 signed cookie, 7-day expiry
- Allowed emails: `prashantkumarbharadwaj@gmail.com`, `prayshikumar2@gmail.com`
- `/api/ingest` exempt from Google auth (uses `INGEST_TOKEN` Bearer)
- All other routes require valid session cookie

## Commands
```bash
npm run dev       # local dev (wrangler dev)
npm run deploy    # deploy to Workers
```

## Automation
- `automation/gmail-poller.gs` — Google Apps Script that polls Gmail and POSTs to `/api/ingest`
- `automation/android-sms-setup.md` — SMS forwarding setup docs
