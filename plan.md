# Expense Tracker — Architecture & Plan

## What's Built

A Cloudflare Worker + D1 database app at:
**https://expense-tracker.prashantkumarbharadwaj.workers.dev**

Same schema as your old Google Sheet:
`Description | Amount | Date | Paid By | Category | Who is it for? | Is it related to marriage?`

---

## Architecture

```
Browser / ChatGPT Custom GPT
        │
        ▼
Cloudflare Worker (expense-tracker.prashantkumarbharadwaj.workers.dev)
        │  serves HTML + API routes
        ├── GET  /                      → web app (mobile-first SPA)
        ├── GET  /api/expenses?month=   → list expenses
        ├── POST /api/expenses          → add expense
        ├── PUT  /api/expenses/:id      → edit expense
        ├── DEL  /api/expenses/:id      → delete expense
        ├── POST /api/parse             → LLM smart parse
        ├── GET  /api/export?month=     → CSV download
        └── GET  /api/openapi.json      → OpenAPI spec (for Custom GPT)
                │
                ▼
        Cloudflare D1 (SQLite)
        expense-tracker-db
        
        (parse route calls)
                │
                ▼
        OpenRouter API → Gemma 3 27B (free)
```

---

## Entry Methods

### 1. Web App (deployed now)
Open the URL on mobile. Two ways to add:

**Manual Add** — fill a form (description, amount, date, paid by, category, who for, marriage flag)

**Smart Add (AI)** — paste anything:
- UPI SMS: `INR 6600.00 debited from your A/c on 01-08-25. Info: HOUSEKEEPING`
- Receipt text copied from Swiggy/Zomato/Amazon
- Natural description: `Uber ride 280, just me, yesterday`
- Forward email content, paste into the text box

LLM (Gemma via OpenRouter) extracts all fields. You review and confirm before saving.

### 2. ChatGPT Custom GPT (recommended for natural entry)

**How it works:**
- Create a Custom GPT at https://chat.openai.com/gpts/editor
- Add this system prompt:
  ```
  You are an expense tracker assistant for Prashant and Prayashi. 
  When they mention spending money, extract the expense details and 
  call addExpense. Always confirm what you're about to save before calling the API.
  Default paid_by = Prashant. Default who_for = Common.
  Today's date = always use current date unless they say otherwise.
  ```
- Add an Action → import from URL: `https://expense-tracker.prashantkumarbharadwaj.workers.dev/api/openapi.json`

**Usage:** Open ChatGPT, switch to your custom GPT, say:
> "Swiggy came for 480 tonight, Prayashi paid, for both of us"

ChatGPT calls the API and saves it. No UI at all — just chat.

**This is the best interface for quick daily entries.** ChatGPT already understands context, dates, relative references ("yesterday", "last week"), etc.

### 3. Gemini Custom Extension (similar to Custom GPT)
Same approach but via Gemini's extension builder. Uses the same OpenAPI spec.

---

## Auto-Fetch (Partially Possible)

| Source | Auto-fetch approach | Feasibility |
|--------|---------------------|-------------|
| UPI SMS | Paste SMS text into Smart Add | ✅ Works now |
| Amazon | Paste order confirmation email body | ✅ Works now |
| Swiggy/Zomato | Paste receipt SMS or email | ✅ Works now |
| Uber | Paste trip receipt SMS | ✅ Works now |
| Myntra/Savana | Paste order confirmation | ✅ Works now |
| Full automation | Email Worker (see below) | 🔜 Phase 2 |

**Phase 2 — Email Auto-Fetch:**
If you have a domain on Cloudflare (e.g., expense@yourdomain.com):
- Set up Cloudflare Email Routing → Email Worker
- Forward order confirmation emails to that address
- Worker parses email body with LLM → auto-saves expense
- Zero manual effort for Amazon/Swiggy/Zomato/Uber
- Requires a domain with Cloudflare DNS management

---

## Setup Remaining

### Required: Set OpenRouter API Key
```bash
wrangler secret put OPENROUTER_API_KEY
# paste your key when prompted
```

### Optional: Change LLM model
Default is `google/gemma-3-27b-it:free`. To change:
```bash
# in wrangler.jsonc, add:
"vars": { "LLM_MODEL": "meta-llama/llama-3.1-8b-instruct:free" }
# then redeploy: wrangler deploy
```

---

## Data Schema

```sql
expenses (
  id              INTEGER PRIMARY KEY,
  description     TEXT,
  amount          REAL,
  date            TEXT,       -- YYYY-MM-DD
  paid_by         TEXT,       -- Prashant | Prayashi
  category        TEXT,       -- Food | Travel | Subscription | Shopping | Rent | Medical | Entertainment | Utilities | Other
  who_for         TEXT,       -- Prashant | Prayashi | Common
  is_marriage_related INTEGER, -- 0 or 1
  source          TEXT,       -- manual | smart
  created_at      TEXT
)
```

---

## Export / Google Sheets Compatibility

Click "Export CSV" in the app → downloads a CSV with the exact same columns as your old Google Sheet. You can paste it directly.

---

## Future Ideas (not built yet)

- **Email Worker**: auto-parse forwarded receipts
- **WhatsApp bot**: via Twilio/Meta Business API → call the POST /api/expenses endpoint
- **Telegram bot**: similar to WhatsApp, easier to set up
- **Monthly budget alerts**: cron job comparing spend vs targets
- **Split calculator**: show how much Prashant owes Prayashi or vice versa based on Common expenses
- **Auth**: add Cloudflare Access (email OTP) to protect the URL if needed
