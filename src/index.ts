import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getHTML } from './html'

const ALLOWED_EMAILS = new Set(['prashantkumarbharadwaj@gmail.com', 'prayashikumari2@gmail.com'])

type Bindings = {
  DB: D1Database
  OPENROUTER_API_KEY: string
  LLM_MODEL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  INGEST_TOKEN: string
  API_KEY: string
}

function b64url(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

async function createSession(secret: string, email: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ email, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })))
  return `${payload}.${await hmacSign(secret, payload)}`
}

async function verifySession(secret: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (sig !== await hmacSign(secret, payload)) return null
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    )
    const data = JSON.parse(json) as { email: string; exp: number }
    if (data.exp < Date.now() || !ALLOWED_EMAILS.has(data.email)) return null
    return data.email
  } catch { return null }
}

function getCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.split(';').find(s => s.trim().startsWith(name + '='))
  return match ? match.split('=').slice(1).join('=').trim() : null
}

interface ExpenseBody {
  description: string
  amount: number
  date: string
  paid_by: string
  category: string
  who_for: string
  is_marriage_related: boolean
  source?: string
  raw_input?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path === '/login' || path.startsWith('/auth/') || path === '/privacy' || path === '/api/ingest') {
    return next()
  }
  const bearer = c.req.header('Authorization')?.replace('Bearer ', '')
  if (bearer && bearer === c.env.API_KEY) return next()
  const token = getCookie(c.req.header('Cookie') ?? '', 'session')
  const email = token ? await verifySession(c.env.SESSION_SECRET, token) : null
  if (!email) {
    return path.startsWith('/api/')
      ? c.json({ error: 'Unauthorized' }, 401)
      : c.redirect('/login')
  }
  return next()
})

app.get('/login', (c) => c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Expense Tracker</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:1rem;padding:2.5rem 2rem;box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center;max-width:340px;width:90%}
h1{font-size:1.25rem;color:#1e293b;margin-bottom:.375rem}
p{color:#64748b;font-size:.875rem;margin-bottom:1.75rem}
.g-btn{display:inline-flex;align-items:center;gap:.625rem;background:#fff;border:1.5px solid #e2e8f0;border-radius:.5rem;padding:.65rem 1.25rem;cursor:pointer;font-size:.9375rem;font-weight:500;color:#1e293b;text-decoration:none;transition:background .15s,border-color .15s}
.g-btn:hover{background:#f8fafc;border-color:#cbd5e1}
</style></head>
<body><div class="card">
<h1>Expense Tracker</h1>
<p>Private — authorised access only</p>
<a href="/auth/google" class="g-btn">
<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
Sign in with Google
</a>
</div></body></html>`))

app.get('/auth/google', async (c) => {
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const origin = new URL(c.req.url).origin
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })
  const headers = new Headers({ Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
  headers.append('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`)
  return new Response(null, { status: 302, headers })
})

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const savedState = getCookie(c.req.header('Cookie') ?? '', 'oauth_state')
  if (!code || !state || state !== savedState) {
    return c.html('<p>Auth failed: invalid state. <a href="/login">Try again</a></p>', 400)
  }
  const origin = new URL(c.req.url).origin
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/auth/callback`, grant_type: 'authorization_code',
    }),
  })
  const tokenData = await tokenRes.json() as { access_token?: string }
  if (!tokenData.access_token) {
    return c.html('<p>Auth failed: token exchange error. <a href="/login">Try again</a></p>', 400)
  }
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const user = await userRes.json() as { email?: string }
  if (!user.email || !ALLOWED_EMAILS.has(user.email)) {
    return c.html('<p>Access denied. <a href="/login">Back</a></p>', 403)
  }
  const session = await createSession(c.env.SESSION_SECRET, user.email)
  const headers = new Headers({ Location: '/' })
  headers.append('Set-Cookie', `session=${session}; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}; Path=/`)
  headers.append('Set-Cookie', `oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`)
  return new Response(null, { status: 302, headers })
})

app.get('/auth/logout', (c) => {
  const headers = new Headers({ Location: '/login' })
  headers.append('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/')
  return new Response(null, { status: 302, headers })
})

app.get('/', (c) => c.html(getHTML()))

app.get('/api/expenses', async (c) => {
  const month = c.req.query('month')
  const stmt = month
    ? c.env.DB.prepare('SELECT * FROM expenses WHERE strftime("%Y-%m", date) = ? ORDER BY date DESC, id DESC').bind(month)
    : c.env.DB.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC')
  const { results } = await stmt.all()
  return c.json(results)
})

app.post('/api/expenses', async (c) => {
  const b = await c.req.json<ExpenseBody>()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(b.description, b.amount, b.date, b.paid_by, b.category, b.who_for, b.is_marriage_related ? 1 : 0, b.source ?? 'manual', b.raw_input ?? null).run()
  return c.json({ id: meta.last_row_id })
})

app.put('/api/expenses/:id', async (c) => {
  const b = await c.req.json<ExpenseBody>()
  await c.env.DB.prepare(
    'UPDATE expenses SET description=?,amount=?,date=?,paid_by=?,category=?,who_for=? WHERE id=?'
  ).bind(b.description, b.amount, b.date, b.paid_by, b.category, b.who_for, c.req.param('id')).run()
  return c.json({ ok: true })
})

app.delete('/api/expenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

app.post('/api/parse', async (c) => {
  const { text } = await c.req.json<{ text: string }>()
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500)

  const today = new Date().toISOString().split('T')[0]
  const model = c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free'

  const prompt = `Parse this expense entry into structured data. Today is ${today}.

Entry: "${text}"

Return ONLY valid JSON:
{
  "description": "short normalized label (e.g. 'Swiggy dinner', 'Uber ride', 'Amazon order - iPhone case')",
  "amount": <number, 0 if unknown>,
  "date": "<YYYY-MM-DD, use today if unclear>",
  "paid_by": "<Prashant|Prayashi, default Prashant>",
  "category": "<choose best fit or invent a new concise category if none fit>",
  "who_for": "<Prashant|Prayashi|Common, default Common>"
}

Common categories (not exhaustive — create a new one if needed):
Food, Travel, Subscription, Shopping, Rent, Medical, Entertainment, Utilities, Groceries, Education, Insurance, EMI, Personal Care, Gifts

Category hints:
- Swiggy/Zomato/restaurant → Food
- Uber/Ola/cab/carwash/petrol/toll → Travel
- Cook/maid/Netflix/Prime/Spotify/annual recurring → Subscription
- Amazon/Myntra/Savana/Meesho/fashion → Shopping
- Unknown payer → Prashant
- "for both"/"split"/"us" → who_for = Common`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker.workers.dev',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })

  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) return c.json({ error: 'Empty LLM response' }, 500)

  try {
    return c.json(JSON.parse(content))
  } catch {
    return c.json({ error: 'LLM returned non-JSON', raw: content }, 500)
  }
})

app.get('/api/export', async (c) => {
  const month = c.req.query('month')
  const stmt = month
    ? c.env.DB.prepare('SELECT * FROM expenses WHERE strftime("%Y-%m", date) = ? ORDER BY date ASC').bind(month)
    : c.env.DB.prepare('SELECT * FROM expenses ORDER BY date ASC')
  const { results } = await stmt.all() as { results: Record<string, unknown>[] }

  const csv = [
    'Description,Amount,Date,Paid By,Category,Who is it for?,Is it related to marriage?',
    ...results.map(e =>
      `"${String(e.description).replace(/"/g, '""')}",${e.amount},${e.date},${e.paid_by},${e.category},${e.who_for},${e.is_marriage_related ? 'Yes' : 'No'}`
    ),
  ].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${month ?? 'all'}.csv"`,
    },
  })
})

app.get('/privacy', (c) => c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Expense Tracker</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:3rem auto;padding:0 1.5rem;color:#1e293b;line-height:1.6}h1{font-size:1.5rem;margin-bottom:.25rem}p,li{color:#475569}ul{padding-left:1.25rem}a{color:#6366f1}</style>
</head><body>
<h1>Privacy Policy</h1>
<p><em>Last updated: June 2026</em></p>
<p>This is a personal expense tracking tool used exclusively by Prashant and Prayashi. No data is shared with third parties.</p>
<h2>Data collected</h2>
<ul>
  <li>Expense entries: description, amount, date, category, who paid, who it was for</li>
  <li>Optional raw input text (original SMS or receipt text you paste)</li>
</ul>
<h2>Data storage</h2>
<p>All data is stored in a Cloudflare D1 database associated with your Cloudflare account. No external analytics or tracking.</p>
<h2>AI processing</h2>
<p>When using Smart Add or AI Analysis, expense text is sent to <a href="https://openrouter.ai">OpenRouter</a> for LLM processing. No data is stored by OpenRouter beyond their standard request logs.</p>
<h2>Contact</h2>
<p>Questions: <a href="mailto:prashantkumarbharadwaj@gmail.com">prashantkumarbharadwaj@gmail.com</a></p>
</body></html>`))

app.post('/api/ingest', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json<{ text: string; source?: string; paid_by?: string; received_date?: string }>()
  if (!body.text?.trim()) return c.json({ error: 'text required' }, 400)

  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  const today = new Date().toISOString().split('T')[0]
  const dateHint = body.received_date
    ? `The email was received on ${body.received_date} — use this as the expense date unless the email explicitly states a different transaction/order date.`
    : `Today is ${today}.`
  const prompt = `You are parsing an automated expense feed (email receipt or UPI SMS). ${dateHint}

Text: """
${body.text.slice(0, 3000)}
"""

Return ONLY valid JSON.

If NOT an expense or refund (promotional email, OTP, newsletter, delivery update with no amount), return {"skip": true}.

If this is a REFUND, CANCELLATION, or CASHBACK where money is returned to the user:
{
  "description": "Refund: <original item or order description>",
  "amount": <negative number e.g. -450>,
  "date": "<YYYY-MM-DD, use refund/credit date>",
  "paid_by": "${body.paid_by ?? 'Prashant'}",
  "category": "<same category as original purchase>",
  "who_for": "<Prashant|Prayashi|Common>"
}

If a normal expense:
{
  "description": "concise label",
  "amount": <positive number>,
  "date": "<YYYY-MM-DD>",
  "paid_by": "${body.paid_by ?? 'Prashant'}",
  "category": "<best fit or new concise category>",
  "who_for": "<Prashant|Prayashi|Common>"
}

Category hints: Swiggy/Zomato→Food, Uber/Ola→Travel, Amazon/Myntra/Savana/Meesho→Shopping, recurring/subscription→Subscription, Instamart/BigBasket/grocery→Groceries.
who_for hints: food order for one person→that person, groceries/household→Common, fashion item for one person→that person, unclear→Common.
If amount not found in a refund email, still return the refund with best-guess amount if inferable, else {"skip": true}.`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker.workers.dev',
    },
    body: JSON.stringify({
      model: c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })

  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(content ?? '') } catch { return c.json({ error: 'LLM parse failed', raw: content }, 500) }

  if (parsed.skip) return c.json({ skipped: true, reason: 'Not an expense or amount missing' })

  const { meta } = await c.env.DB.prepare(
    'INSERT INTO pending_expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,0,?,?)'
  ).bind(parsed.description, parsed.amount, parsed.date, parsed.paid_by, parsed.category, parsed.who_for, body.source ?? 'ingest', body.text.slice(0, 1000)).run()

  return c.json({ pending: true, id: meta.last_row_id, expense: parsed })
})

app.get('/api/pending', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM pending_expenses ORDER BY created_at DESC'
  ).all()
  return c.json(results)
})

app.post('/api/pending/:id/approve', async (c) => {
  const id = c.req.param('id')
  const overrides = await c.req.json<Partial<ExpenseBody>>().catch(() => ({}))
  const { results } = await c.env.DB.prepare('SELECT * FROM pending_expenses WHERE id=?').bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  const p = results[0] as Record<string, unknown>
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(
    overrides.description ?? p.description,
    overrides.amount ?? p.amount,
    overrides.date ?? p.date,
    overrides.paid_by ?? p.paid_by,
    overrides.category ?? p.category,
    overrides.who_for ?? p.who_for,
    overrides.is_marriage_related !== undefined ? (overrides.is_marriage_related ? 1 : 0) : p.is_marriage_related,
    p.source, p.raw_input
  ).run()
  await c.env.DB.prepare('DELETE FROM pending_expenses WHERE id=?').bind(id).run()
  return c.json({ ok: true, expense_id: meta.last_row_id })
})

app.delete('/api/pending/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM pending_expenses WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

app.get('/api/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT category FROM expenses ORDER BY category ASC'
  ).all() as { results: { category: string }[] }
  const fromDb = results.map(r => r.category)
  const defaults = ['Food','Travel','Subscription','Shopping','Rent','Medical','Entertainment','Utilities','Groceries','Education','Insurance','EMI','Personal Care','Gifts','Other']
  const all = [...new Set([...defaults, ...fromDb])].sort()
  return c.json(all)
})

app.get('/api/analyze', async (c) => {
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not configured' }, 500)
  const month = c.req.query('month')
  const stmt = month
    ? c.env.DB.prepare('SELECT * FROM expenses WHERE strftime("%Y-%m", date) = ? ORDER BY date ASC').bind(month)
    : c.env.DB.prepare('SELECT * FROM expenses ORDER BY date ASC')
  const { results } = await stmt.all() as { results: Record<string, unknown>[] }
  if (!results.length) return c.json({ insights: ['No expenses recorded this month yet.'] })

  const total = results.reduce((s, e) => s + (e.amount as number), 0)
  const byCat: Record<string, number> = {}
  const cmnP = results.filter(e => e.who_for === 'Common' && e.paid_by === 'Prashant').reduce((s, e) => s + (e.amount as number), 0)
  const cmnQ = results.filter(e => e.who_for === 'Common' && e.paid_by === 'Prayashi').reduce((s, e) => s + (e.amount as number), 0)
  results.forEach(e => { const k = e.category as string; byCat[k] = (byCat[k] || 0) + (e.amount as number) })

  const summary = [
    `Period: ${month ?? 'all time'}`,
    `Total: ₹${total.toFixed(0)} across ${results.length} transactions`,
    `By category: ${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ₹${v.toFixed(0)}`).join(', ')}`,
    `Common expenses — Prashant paid ₹${cmnP.toFixed(0)}, Prayashi paid ₹${cmnQ.toFixed(0)}`,
    `Net settlement: ${Math.abs((cmnP-cmnQ)/2) < 1 ? 'settled' : (cmnP > cmnQ ? `Prayashi owes Prashant ₹${((cmnP-cmnQ)/2).toFixed(0)}` : `Prashant owes Prayashi ₹${((cmnQ-cmnP)/2).toFixed(0)}`)}`,
  ].join('\n')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker.workers.dev',
    },
    body: JSON.stringify({
      model: c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
      messages: [{ role: 'user', content: `You are a personal finance analyst for a couple (Prashant & Prayashi). Analyze their expenses and give 4–6 short, practical insights. Focus on dominant categories, settlement fairness, and one actionable saving tip.\n\n${summary}\n\nReturn ONLY JSON: { "insights": ["...", "..."] }` }],
      response_format: { type: 'json_object' },
    }),
  })
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  try { return c.json(JSON.parse(content ?? '')) } catch { return c.json({ error: 'LLM parse failed' }, 500) }
})

// OpenAPI spec — paste at https://platform.openai.com/gpts when creating a Custom GPT action
app.get('/api/openapi.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'Expense Tracker',
      version: '1.0.0',
      description: 'Personal expense tracker for Prashant & Prayashi. paid_by: Prashant or Prayashi. who_for: Prashant, Prayashi, or Common (Common = split equally). category: open-ended string — use common ones (Food, Travel, Subscription, Shopping, Rent, Medical, Entertainment, Utilities, Groceries, Education, Insurance, EMI, Personal Care, Gifts) or create a new one if none fit.',
    },
    servers: [{ url: origin }],
    components: {
      schemas: {
        Expense: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Unique expense ID — required for editExpense and deleteExpense' },
            description: { type: 'string' },
            amount: { type: 'number' },
            date: { type: 'string', format: 'date' },
            paid_by: { type: 'string' },
            category: { type: 'string' },
            who_for: { type: 'string' },
            raw_input: { type: 'string' },
            source: { type: 'string' },
          },
        },
        ExpenseInput: {
          type: 'object',
          required: ['description', 'amount', 'date', 'paid_by', 'category', 'who_for'],
          properties: {
            description: { type: 'string', description: 'Normalized short label for the expense' },
            amount: { type: 'number', description: 'Amount in INR' },
            date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
            paid_by: { type: 'string', enum: ['Prashant', 'Prayashi'] },
            category: { type: 'string', description: 'Expense category — free text, any string is accepted. Common values: Food, Travel, Subscription, Shopping, Rent, Medical, Entertainment, Utilities, Groceries, Education, Insurance, EMI, Personal Care, Gifts. If none fit, invent a concise new category name (e.g. "Pet Care", "Fuel", "Hobby") and pass it — the backend stores it as-is and the UI will display it.' },
            who_for: { type: 'string', enum: ['Prashant', 'Prayashi', 'Common'], description: '"Common" means split equally between both' },
            raw_input: { type: 'string', description: 'Exact original text the user said or typed — store verbatim' },
          },
        },
      },
    },
    paths: {
      '/api/categories': {
        get: {
          operationId: 'listCategories',
          summary: 'List all known expense categories',
          description: 'Returns all distinct categories currently in the database merged with defaults. Call this to see what categories exist. You can still pass any new category string to addExpense — it will be stored and appear here on the next call.',
          responses: {
            '200': {
              description: 'Sorted array of category strings',
              content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
            },
          },
        },
      },
      '/api/expenses': {
        get: {
          operationId: 'listExpenses',
          summary: 'List expenses for a month',
          parameters: [{ name: 'month', in: 'query', schema: { type: 'string' }, description: 'YYYY-MM format, e.g. 2025-08' }],
          responses: {
            '200': {
              description: 'Array of expenses',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { '$ref': '#/components/schemas/Expense' } },
                },
              },
            },
          },
        },
        post: {
          operationId: 'addExpense',
          summary: 'Add a new expense',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExpenseInput' },
              },
            },
          },
          responses: { '200': { description: 'Created with id' } },
        },
      },
      '/api/expenses/{id}': {
        put: {
          operationId: 'editExpense',
          summary: 'Edit an existing expense by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExpenseInput' },
              },
            },
          },
          responses: { '200': { description: 'Updated' } },
        },
        delete: {
          operationId: 'deleteExpense',
          summary: 'Delete an expense by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Deleted' } },
        },
      },
      '/api/pending': {
        get: {
          operationId: 'listPending',
          summary: 'List pending expenses awaiting review',
          description: 'Returns auto-imported expenses from Gmail that have not yet been approved. Review these and approve or reject each one. Always ask the user to confirm who paid and who it was for before approving.',
          responses: {
            '200': {
              description: 'Array of pending expenses',
              content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Expense' } } } },
            },
          },
        },
      },
      '/api/pending/{id}/approve': {
        post: {
          operationId: 'approvePending',
          summary: 'Approve a pending expense and move it to expenses',
          description: 'Approves the pending item. Optionally pass updated fields (paid_by, who_for, category, etc.) to correct before saving. Always confirm paid_by and who_for with the user first.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: false,
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/ExpenseInput' } } },
          },
          responses: { '200': { description: 'Approved and saved as expense' } },
        },
      },
      '/api/pending/{id}': {
        delete: {
          operationId: 'rejectPending',
          summary: 'Reject and discard a pending expense',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Rejected' } },
        },
      },
    },
  })
})

export default app
