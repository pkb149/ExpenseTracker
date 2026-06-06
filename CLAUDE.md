# ExpenseTracker — Project Context

## Stack
- Cloudflare Pages (Hono framework, TypeScript), bundled with esbuild → `dist/_worker.js`
- Cloudflare D1 (SQLite) — binding: `DB`, database: `expense-tracker-db` (id: `72ceadd5-0c30-43eb-b107-0d7ca59455e8`)
- OpenRouter for LLM (parse & analyze endpoints)
- Deployed at: `https://expense-tracker-4er.pages.dev`

## Source files
- `src/index.ts` — all routes and middleware
- `src/html.ts` — full frontend SPA (vanilla JS, inline `<script>` in HTML template literal)
- `schema.sql` — D1 schema
- `wrangler.jsonc` — Wrangler config
- `scripts/check-js.js` — syntax-checks the inline `<script>` block post-build
- `scripts/cdp-screenshot.js` — Playwright via CDP for real-session debugging

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

## Automation
- `automation/gmail-poller.gs` — Google Apps Script that polls Gmail and POSTs to `/api/ingest`
- Runs hourly; backfill() processes last 37 days in batches of 40
