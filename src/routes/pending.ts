import { Hono } from 'hono'
import type { Bindings, ExpenseBody } from '../types'

const pending = new Hono<{ Bindings: Bindings }>()

pending.get('/api/pending', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM pending_expenses WHERE status='pending' ORDER BY created_at DESC"
  ).all()
  return c.json(results)
})

pending.post('/api/pending/:id/approve', async (c) => {
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
  await c.env.DB.prepare("UPDATE pending_expenses SET status='approved' WHERE id=?").bind(id).run()
  return c.json({ ok: true, expense_id: meta.last_row_id })
})

pending.delete('/api/pending/:id', async (c) => {
  await c.env.DB.prepare("UPDATE pending_expenses SET status='rejected' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default pending
