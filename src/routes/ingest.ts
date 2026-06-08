import { Hono } from 'hono'
import type { Bindings } from '../types'

const ingest = new Hono<{ Bindings: Bindings }>()

ingest.post('/api/ingest', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json<{ text: string; source?: string; paid_by?: string; received_date?: string }>()
  if (!body.text?.trim()) return c.json({ error: 'text required' }, 400)

  const { meta } = await c.env.DB.prepare(
    'INSERT INTO pending_emails (raw_text, source, paid_by, received_date) VALUES (?,?,?,?)'
  ).bind(body.text, body.source ?? 'ingest', body.paid_by ?? 'Prashant', body.received_date ?? null).run()

  return c.json({ queued: true, id: meta.last_row_id })
})

ingest.get('/api/pending-emails', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, source, paid_by, received_date, created_at, substr(raw_text,1,200) as preview FROM pending_emails WHERE status='pending' ORDER BY created_at DESC"
  ).all()
  return c.json(results)
})

ingest.get('/api/pending-emails/:id', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM pending_emails WHERE id=? AND status='pending'"
  ).bind(c.req.param('id')).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  return c.json(results[0])
})

ingest.delete('/api/pending-emails/:id', async (c) => {
  await c.env.DB.prepare("UPDATE pending_emails SET status='processed' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

ingest.post('/api/pending-emails/:id/process', async (c) => {
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM pending_emails WHERE id=? AND status='pending'"
  ).bind(c.req.param('id')).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)

  const email = results[0] as Record<string, unknown>
  const text = email.raw_text as string
  const paidBy = email.paid_by as string
  const receivedDate = email.received_date as string | null

  const today = new Date().toISOString().split('T')[0]
  const dateHint = receivedDate
    ? `The email was received on ${receivedDate} — use this as the expense date unless the email explicitly states a different transaction/order date.`
    : `Today is ${today}.`

  const prompt = `You are parsing an automated expense feed (email receipt or UPI SMS). ${dateHint}

Text: """
${text.slice(0, 3000)}
"""

Return ONLY valid JSON.

If NOT an expense or refund (promotional email, OTP, newsletter, delivery update with no amount), return {"skip": true}.
Also return {"skip": true} for: credit card bill payments, credit card outstanding due reminders, credit card statement emails, loan EMI debit alerts — these are payment settlements, not expenses.

If this is a REFUND, CANCELLATION, or CASHBACK where money is returned to the user:
{
  "description": "Refund: Brand - <original item>",
  "amount": <negative number e.g. -450>,
  "date": "<YYYY-MM-DD>",
  "paid_by": "${paidBy}",
  "category": "<same category as original purchase>",
  "who_for": "<Prashant|Prayashi|Common>",
  "order_id": "<order/transaction/booking ID if found, else null>"
}

If a normal expense:
{
  "description": "Brand - item (e.g. Zomato - McDonald's meal)",
  "amount": <positive number>,
  "date": "<YYYY-MM-DD>",
  "paid_by": "${paidBy}",
  "category": "<best fit or new concise category>",
  "who_for": "<Prashant|Prayashi|Common>",
  "order_id": "<order/transaction/booking ID if found, else null>"
}

Category hints: Swiggy/Zomato->Food, Uber/Ola->Travel, Amazon/Myntra->Shopping, recurring->Subscription, grocery->Groceries.
who_for hints: food for one->that person, groceries->Common, fashion for one->that person, unclear->Common.
WALLET PAYMENTS: If paid via Amazon Pay wallet/prepaid balance (not UPI/card), prefix category with "wallet_".`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker-4er.pages.dev',
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

  if (parsed.skip) {
    await c.env.DB.prepare("UPDATE pending_emails SET status='processed' WHERE id=?").bind(c.req.param('id')).run()
    return c.json({ skipped: true })
  }

  if (parsed.order_id) {
    const { results: dup } = await c.env.DB.prepare(
      'SELECT id FROM pending_expenses WHERE order_id=? UNION SELECT id FROM expenses WHERE order_id=?'
    ).bind(parsed.order_id, parsed.order_id).all()
    if (dup.length) {
      await c.env.DB.prepare("UPDATE pending_emails SET status='processed' WHERE id=?").bind(c.req.param('id')).run()
      return c.json({ skipped: true, reason: 'Duplicate order_id' })
    }
  } else {
    const d = parsed.date as string
    const { results: dup } = await c.env.DB.prepare(
      `SELECT id FROM pending_expenses WHERE ABS(amount-?) < 0.01 AND date >= date(?,'-7 days') AND date <= date(?,'+7 days')
       UNION SELECT id FROM expenses WHERE ABS(amount-?) < 0.01 AND date >= date(?,'-7 days') AND date <= date(?,'+7 days')`
    ).bind(parsed.amount, d, d, parsed.amount, d, d).all()
    if (dup.length) {
      await c.env.DB.prepare("UPDATE pending_emails SET status='processed' WHERE id=?").bind(c.req.param('id')).run()
      return c.json({ skipped: true, reason: 'Likely duplicate' })
    }
  }

  const { meta } = await c.env.DB.prepare(
    'INSERT INTO pending_expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input,order_id) VALUES (?,?,?,?,?,?,0,?,?,?)'
  ).bind(parsed.description, parsed.amount, parsed.date, parsed.paid_by, parsed.category, parsed.who_for, 'ingest', text.slice(0, 1000), parsed.order_id ?? null).run()

  await c.env.DB.prepare("UPDATE pending_emails SET status='processed' WHERE id=?").bind(c.req.param('id')).run()

  return c.json({ pending: true, id: meta.last_row_id, expense: parsed })
})

export default ingest
