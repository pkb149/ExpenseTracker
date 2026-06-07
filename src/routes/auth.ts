import { Hono } from 'hono'
import type { Bindings } from '../types'
import { b64url, createSession, getCookie, ALLOWED_EMAILS } from '../lib/auth'

const auth = new Hono<{ Bindings: Bindings }>()

auth.get('/login', (c) => c.html(`<!DOCTYPE html>
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

auth.get('/auth/google', async (c) => {
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

auth.get('/auth/callback', async (c) => {
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

auth.get('/auth/logout', (c) => {
  const headers = new Headers({ Location: '/login' })
  headers.append('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/')
  return new Response(null, { status: 302, headers })
})

auth.get('/privacy', (c) => c.html(`<!DOCTYPE html>
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

export default auth
