import { Hono } from 'hono'
import type { Bindings, ExpenseBody } from '../types'

const pending = new Hono<{ Bindings: Bindings }>()

pending.get('/api/pending', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM pending_expenses WHERE status='pending' ORDER BY created_at DESC"
  ).all()
  return c.json(results)
})

pending.post('/api/pending', async (c) => {
  const body = await c.req.json<{ description: string; amount: number; date: string; paid_by: string; category: string; who_for: string; source?: string; raw_input?: string }>()
  if (!body.description || body.amount == null || !body.date || !body.paid_by || !body.category || !body.who_for) {
    return c.json({ error: 'description, amount, date, paid_by, category, who_for required' }, 400)
  }
  const validWhoFor = new Set(['Prashant', 'Prayashi', 'Common'])
  if (!validWhoFor.has(body.who_for)) return c.json({ error: 'who_for must be Prashant, Prayashi, or Common' }, 400)
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO pending_expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,0,?,?)'
  ).bind(body.description, body.amount, body.date, body.paid_by, body.category, body.who_for, body.source ?? 'chatgpt', body.raw_input ?? null).run()
  return c.json({ ok: true, id: meta.last_row_id })
})

pending.post('/api/pending/:id/approve', async (c) => {
  const id = c.req.param('id')
  const overrides = await c.req.json<Partial<ExpenseBody> & { force?: boolean }>().catch(() => ({}))
  const { results } = await c.env.DB.prepare('SELECT * FROM pending_expenses WHERE id=?').bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  const p = results[0] as Record<string, unknown>
  const amount = overrides.amount ?? p.amount
  const date = overrides.date ?? p.date as string
  if (!overrides.force) {
    const { results: dups } = await c.env.DB.prepare(
      "SELECT * FROM expenses WHERE ABS(amount-?) < 0.01 AND strftime('%Y-%m',date)=strftime('%Y-%m',?) LIMIT 1"
    ).bind(amount, date).all() as { results: Record<string, unknown>[] }
    if (dups.length) {
      const d = dups[0]
      return c.json({
        error: 'duplicate_detected',
        existing: d,
        message: `Possible duplicate: ₹${d.amount} already exists in this month — "${d.description}" on ${d.date}, paid by ${d.paid_by}, for ${d.who_for} (id=${d.id}). To override, add "force": true to your request body.`,
      }, 409)
    }
  }
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(
    overrides.description ?? p.description,
    amount,
    date,
    overrides.paid_by ?? p.paid_by,
    overrides.category ?? p.category,
    overrides.who_for ?? p.who_for,
    overrides.is_marriage_related !== undefined ? (overrides.is_marriage_related ? 1 : 0) : p.is_marriage_related,
    p.source, p.raw_input
  ).run()
  await c.env.DB.prepare("UPDATE pending_expenses SET status='approved' WHERE id=?").bind(id).run()
  return c.json({ ok: true, expense_id: meta.last_row_id })
})

pending.delete('/api/pending/:id', async (c) => {
  await c.env.DB.prepare("UPDATE pending_expenses SET status='rejected' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default pending
