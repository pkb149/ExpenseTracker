import { Hono } from 'hono'
import type { Bindings } from '../types'

const ingest = new Hono<{ Bindings: Bindings }>()

ingest.post('/api/ingest', async (c) => {
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
Also return {"skip": true} for: credit card bill payments, credit card outstanding due reminders, credit card statement emails, loan EMI debit alerts — these are payment settlements, not expenses.

If this is a REFUND, CANCELLATION, or CASHBACK where money is returned to the user:
{
  "description": "Refund: Brand - <original item> (e.g. 'Refund: Myntra - Nike shoes')",
  "amount": <negative number e.g. -450>,
  "date": "<YYYY-MM-DD, use refund/credit date>",
  "paid_by": "${body.paid_by ?? 'Prashant'}",
  "category": "<same category as original purchase>",
  "who_for": "<Prashant|Prayashi|Common>",
  "order_id": "<order/transaction/booking ID if found, else null>"
}

If a normal expense:
{
  "description": "Brand - item (e.g. 'Zomato - McDonald\\'s meal', 'Amazon - boAt earphones', 'Myntra - Nike shoes', 'Swiggy - Pizza Hut order'). Always prefix with the merchant/platform name extracted from the From: address or email content.",
  "amount": <positive number>,
  "date": "<YYYY-MM-DD>",
  "paid_by": "${body.paid_by ?? 'Prashant'}",
  "category": "<best fit or new concise category>",
  "who_for": "<Prashant|Prayashi|Common>",
  "order_id": "<order/transaction/booking ID if found in email, else null>"
}

Category hints: Swiggy/Zomato→Food, Uber/Ola→Travel, Amazon/Myntra/Savana/Meesho→Shopping, recurring/subscription→Subscription, Instamart/BigBasket/grocery→Groceries.
who_for hints: food order for one person→that person, groceries/household→Common, fashion item for one person→that person, unclear→Common.
If amount not found in a refund email, still return the refund with best-guess amount if inferable, else {"skip": true}.
IMPORTANT: Always use the ORDER TOTAL amount, never individual item prices. If this email is a per-item breakdown or shipping update with no order total, return {"skip": true}. Prefer order confirmation emails over item-level emails.
WALLET PAYMENTS: If the payment was made using Amazon Pay wallet balance, Amazon Pay Later, or any wallet/prepaid balance (not UPI/card/netbanking), prefix the category with "wallet_" (e.g. "wallet_Shopping", "wallet_Groceries"). These are wallet spend-downs, not real cash outflows.`

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

  if (parsed.order_id) {
    const { results: dup } = await c.env.DB.prepare(
      'SELECT id FROM pending_expenses WHERE order_id=? UNION SELECT id FROM expenses WHERE order_id=?'
    ).bind(parsed.order_id, parsed.order_id).all()
    if (dup.length) return c.json({ skipped: true, reason: 'Duplicate order_id' })
  } else {
    const d = parsed.date as string
    const { results: dup } = await c.env.DB.prepare(
      `SELECT id FROM pending_expenses WHERE ABS(amount-?) < 0.01 AND date >= date(?,'-7 days') AND date <= date(?,'+7 days')
       UNION SELECT id FROM expenses WHERE ABS(amount-?) < 0.01 AND date >= date(?,'-7 days') AND date <= date(?,'+7 days')`
    ).bind(parsed.amount, d, d, parsed.amount, d, d).all()
    if (dup.length) return c.json({ skipped: true, reason: 'Likely duplicate: same amount within 7 days' })
  }

  const { meta } = await c.env.DB.prepare(
    'INSERT INTO pending_expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input,order_id) VALUES (?,?,?,?,?,?,0,?,?,?)'
  ).bind(parsed.description, parsed.amount, parsed.date, parsed.paid_by, parsed.category, parsed.who_for, body.source ?? 'ingest', body.text.slice(0, 1000), parsed.order_id ?? null).run()

  return c.json({ pending: true, id: meta.last_row_id, expense: parsed })
})

export default ingest
