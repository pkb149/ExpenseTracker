import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './types'
import { verifySession, getCookie } from './lib/auth'
import { getHTML } from './html'
import authRoutes from './routes/auth'
import expenseRoutes from './routes/expenses'
import ingestRoutes from './routes/ingest'
import pendingRoutes from './routes/pending'
import statementRoutes from './routes/statements'
import chatRoutes from './routes/chat'

const EXEMPT_PATHS = new Set([
  '/login', '/privacy',
  '/api/ingest', '/api/statement-upload', '/api/statement-ingest',
])

function isExempt(path: string): boolean {
  if (EXEMPT_PATHS.has(path)) return true
  if (/^\/api\/pending-statements\/\d+\/process-async$/.test(path)) return true
  return false
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (isExempt(path) || path.startsWith('/auth/')) return next()
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

app.get('/', (c) => c.html(getHTML()))

app.route('/', authRoutes)
app.route('/', expenseRoutes)
app.route('/', ingestRoutes)
app.route('/', pendingRoutes)
app.route('/', statementRoutes)
app.route('/', chatRoutes)

export default app
