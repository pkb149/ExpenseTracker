# ExpenseTracker — Project Context

## Stack
- Cloudflare Pages (Hono framework, TypeScript), bundled with esbuild → `dist/_worker.js`
- Cloudflare D1 (SQLite) — binding: `DB`, database: `expense-tracker-db` (id: `72ceadd5-0c30-43eb-b107-0d7ca59455e8`)
- OpenRouter for LLM (parse & analyze endpoints)
- Deployed at: `https://expense-tracker-4er.pages.dev`

## File ownership — which file to edit for each change

### Backend — modular, one concern per file

#### `src/index.ts` (~40 lines) — entry point only
App setup, CORS middleware, auth middleware, route mounting. Touch only for:
- Adding a new route module
- Changing exempt paths (auth bypass list)
- Global middleware changes

#### `src/types.ts` — shared types
`Bindings`, `ExpenseBody`, `TxRow`. Touch when adding a new D1 binding or shared interface.

#### `src/lib/auth.ts` — auth crypto utilities
`b64url`, `hmacSign`, `createSession`, `verifySession`, `getCookie`, `ALLOWED_EMAILS`. Touch for session logic or adding allowed users.

#### `src/routes/auth.ts` — auth + static pages
`GET /login`, `GET /auth/google`, `GET /auth/callback`, `GET /auth/logout`, `GET /privacy`

#### `src/routes/expenses.ts` — expense CRUD + parse + export
`GET/POST /api/expenses`, `PUT/DELETE /api/expenses/:id`, `POST /api/parse`, `GET /api/export`

#### `src/routes/ingest.ts` — Gmail poller ingest
`POST /api/ingest` — LLM parsing, dedup, wallet_ prefix logic

#### `src/routes/pending.ts` — pending expense queue
`GET /api/pending`, `POST /api/pending/:id/approve`, `DELETE /api/pending/:id`

#### `src/routes/statements.ts` — PDF statement reconciliation
`reconcileStatement()` helper, `POST /api/statement-upload`, `POST /api/statement-ingest`, `GET /api/pending-statements`, `POST /api/pending-statements/:id/unlock`, `POST /api/pending-statements/:id/retry`, `POST /api/pending-statements/:id/process-async`, `GET /api/pending-statements/:id/status`, `DELETE /api/pending-statements/:id`

#### `src/routes/chat.ts` — AI features + metadata
`GET /api/categories`, `POST /api/chat`, `GET /api/analyze`, `GET /api/openapi.json`

### Frontend

#### `src/html.ts` (~1000 lines) — entire SPA
CSS (lines 8–220), HTML markup (lines 221–343), inline `<script>` (lines ~344–976). Touch for:
- Any visual/UI change
- Month navigation (`prevMonth`/`nextMonth` ~368, `pushMonth` ~366)
- Summary cards (`renderSummary` ~420) — Prashant/Prayashi/Common/Total
- Settlement card + modal (`openSettleModal` ~793, `recordSettlement` ~801)
- Expense list + filtering (`renderList` ~618, `filterExpenses` ~596)
- Add/edit modal (`openAddModal` ~649, `openEditModal` ~659, `submitForm` ~677)
- Smart parse modal (`openSmartModal` ~708, `doParse` ~715)
- Pending review modal (`openPendingModal` ~836, `renderPendingList` ~842, `approvePending` ~876, `approveAll` ~898)
- Statements modal (`openStmtModal` ~919, `renderStmtList` ~925, `unlockStmt` ~947, `rejectStmt` ~986)
- Chat UI (`startChat` ~507, `sendChatMessage` ~541, `restoreChat` ~484)
- Month picker (`openMonthPicker` ~765, `applyMonthPicker` ~772)
- FAB (`toggleFab` ~354)

### Other files

#### `schema.sql` — DB schema only
Tables: `expenses`, `pending_expenses`, `pending_statements`, `statement_imports`. Touch for column/index changes.

### `wrangler.jsonc` — deployment config
D1 binding, Pages project name, compatibility flags. Touch for infra/binding changes.

### `automation/gmail-poller.gs` — Gmail poller (Google Apps Script)
Polls Gmail, POSTs to `/api/ingest`. Touch for email parsing rules, polling interval, backfill.

### `scripts/check-js.js` — CI safety check
Extracts `<script>` block from built `_worker.js`, runs `new Function()` on it. Do not edit unless the extraction regex breaks.

### `scripts/cdp-screenshot.js` — debug tool only
Takes screenshot via CDP. Not part of app logic.

## Wrangler secrets (set via `wrangler secret put`)
| Secret | Purpose |
|--------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (`656350270076-t73elhid1h7st9gehup7093emaeeuln5.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (from downloaded JSON) |
| `SESSION_SECRET` | HMAC key for signing session cookies (random 32-byte hex) |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM calls |
| `INGEST_TOKEN` | Bearer token for `/api/ingest` (Gmail poller) |
| `API_KEY` | Bearer token for GPT integration |
| `LLM_MODEL` | Optional — defaults to `openai/gpt-oss-120b:free` |

## Google OAuth app
- Project: `paired-498510`
- OAuth consent screen: External, test users only
- Redirect URI: `https://expense-tracker-4er.pages.dev/auth/callback`
- JS origin: `https://expense-tracker-4er.pages.dev`
- Client secret JSON: `~/Downloads/client_secret_656350270076-*.json`

## Auth
- Google OAuth 2.0 (server-side code flow)
- Session: HMAC-SHA256 signed cookie, 7-day expiry
- Allowed emails: `prashantkumarbharadwaj@gmail.com`, `prayashikumari2@gmail.com`
- `/api/ingest` exempt from Google auth (uses `INGEST_TOKEN` Bearer)
- All other routes require valid session cookie

## Commands
```bash
make build    # esbuild bundle
make check    # build + syntax-check inline JS (REQUIRED before deploy)
make deploy   # build + check + wrangler pages deploy
npm run dev   # local dev
```

## Log level (LOG_LEVEL env var)
Controlled via `LOG_LEVEL` Cloudflare secret. Two levels:
- `error` (default / unset) — only errors logged (FAIL lines, skipped pages, subrequest failures)
- `debug` — full trace: extract bytes, page count, per-page progress, subrequest responses

```bash
# Enable debug logging
npx wrangler secret put LOG_LEVEL --env production
# enter: debug

# Revert to error-only
npx wrangler secret delete LOG_LEVEL --env production
# or set it back to: error
```

## Watching Worker logs (wrangler tail)
```bash
# 1. Get latest deployment ID
npx wrangler pages deployment list --project-name expense-tracker | head -10

# 2. Tail logs (replace DEPLOYMENT_ID with the full UUID from step 1)
npx wrangler pages deployment tail <DEPLOYMENT_ID> --project-name expense-tracker --format pretty
```
- `make deploy` output shows the deployment URL prefix (e.g. `51379844.expense-tracker-4er.pages.dev`) — the UUID is `51379844-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, get full UUID from step 1
- `console.log` output appears inline with request logs
- Subrequests fired via `waitUntil(fetch(...))` may not appear as separate request lines — check for `console.log` entries instead

## HTML Template Literal Safety (CRITICAL)
`src/html.ts` returns the entire HTML as a TypeScript template literal. esbuild evaluates escape sequences inside template literals:
- `'\n'` → actual newline → unterminated JS string → syntax error in browser
- `\'` → bare `'` → breaks single-quoted JS strings containing apostrophes
- Fix: use `'\\n'` for literal newlines in inline JS; use `"..."` for strings with apostrophes
- **Always run `make check` after editing html.ts** — catches these before deploy

## Debugging UI Breakage
Blank UI (no month, no expenses, no categories) = JS syntax error in `<script>` block.
1. `make check` — fastest local check
2. CDP workflow below — real browser console with user session

## Playwright via CDP (real session, not sandboxed)
Playwright MCP always redirects to /login. To debug with the real session:

```bash
# Step 1: launch Chrome with CDP + user cookies (run once)
TMPDIR=/tmp/chrome-cdp && rm -rf $TMPDIR && mkdir -p $TMPDIR/Default
cp ~/Library/Application\ Support/Google/Chrome/Default/Cookies $TMPDIR/Default/
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir=$TMPDIR \
  https://expense-tracker-4er.pages.dev &
sleep 4
curl -s http://localhost:9222/json/version  # verify CDP is live

# Step 2: screenshot + console error check
node scripts/cdp-screenshot.js [url] [output.png]
```

**Rules:**
- Chrome rejects `--remote-debugging-port` with the default profile dir — must use a temp dir
- Copy `Cookies` from the real Chrome profile so the session carries over
- `mcp__chrome-devtools__*` MCP tools do NOT connect to this CDP instance

## PDF Statement Processing — Architecture & Lessons

### Async processing pipeline
Password-locked PDFs go through two-stage async processing via self-subrequests:
1. **Extract stage**: PDF → text pages (stored in `unlock_result.pages[]`)
2. **Reconcile stage**: 1 page per CF invocation → LLM → insert to `pending_expenses`

Each stage fires the next via `c.executionCtx.waitUntil(fetch('/process-async', ...))`. State tracked entirely in `unlock_result` JSON on `pending_statements` row.

### Cloudflare Pages Function limits
- **CF kills subrequest invocations at ~45s wall-clock** — this is a hard limit for Pages Functions, not documented but observed.
- **`setTimeout` does NOT fire during I/O waits** — CF suspends JS while a fetch is pending. Use `AbortSignal.timeout(ms)` instead (supported since compat date `2023-03-01`).
- **Subrequest logs are invisible in `wrangler tail`** — only the original HTTP request appears. Use D1 state polling to observe progress.

### Auto-reset pattern
Status endpoint (`GET /api/pending-statements/:id/status`) acts as the watchdog:
- If `unlock_status='processing'` and `started_at` is > 50s ago → reset to `'failed'`
- Preserves `pages`, `pages_done`, `page`, `page_model_idx` so retry can resume
- `started_at` is reset at the start of EACH page invocation (not once per job)

UI polls status every 2s. On `'failed'` with `has_pages=true` → auto-retries (infinite, no user action needed).

### Model cycling across retries
Each page tracks `page_model_idx` in state. One model per invocation:
1. Try model at index 0 with `AbortSignal.timeout(40000)`
2. On failure: increment `page_model_idx`, return (no chain). Auto-reset fires → auto-retry fires → same page, next model.
3. All models exhausted (`page_model_idx >= 3`): skip page, chain to next.

**Model order** (most reliable first, based on testing):
```typescript
const MODEL_LIST = [
  'openrouter/free',          // auto-selects free model — best performer
  'google/gemma-4-31b-it:free', // fallback
  LLM_MODEL ?? 'openai/gpt-oss-120b:free', // last resort — consistently slow/errors
]
```
`openai/gpt-oss-120b:free` (default `LLM_MODEL`) consistently returns errors or hangs. `openrouter/free` tends to eventually succeed.

### Resume without password
After extract stage, pages are stored in DB. If processing fails:
- `POST /api/pending-statements/:id/retry` — no password, resumes from first undone page with correct `page_model_idx`
- UI shows "Retry (page N/M)" button when `has_pages=true` in failed state
- Auto-retry handles this automatically — manual button only shown after polling times out (>120 polls)

### Debugging LLM calls via D1
```bash
npx wrangler d1 execute expense-tracker-db --remote --command \
  "SELECT json_extract(unlock_result,'$.progress') as p, \
          json_extract(unlock_result,'$.page_model_idx') as mi, \
          json_extract(unlock_result,'$.llm_status') as ls, \
          unlock_status as s \
   FROM pending_statements WHERE id=<ID>"
```
`llm_status` shows current model attempt and result (cleared on page success). `last_llm_status` preserved in failed state from auto-reset.

### Wrangler secrets for Pages (not Workers)
```bash
# Pages secrets use different command:
npx wrangler pages secret put <KEY> --project-name expense-tracker
# NOT: npx wrangler secret put (that's for Workers)
```

### Soft-delete processed statements
Processed rows set `unlock_status='processed'`, `processed_at`, `unlock_result=NULL`. Hidden from list. Hard-deleted after 1 year TTL on next list fetch.

## Automation
- `automation/gmail-poller.gs` — Google Apps Script
  - `pollEmails()` — polls Gmail receipts, POSTs to `/api/ingest` (hourly)
  - `pollStatements()` — polls Gmail for PDF attachments, POSTs to `/api/statement-upload` (daily 8am)
  - `backfill()` / `backfillStatements()` — manual one-shot backfill for last 37/90 days
