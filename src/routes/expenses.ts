import { Hono } from 'hono'
import type { Bindings, ExpenseBody } from '../types'

const expenses = new Hono<{ Bindings: Bindings }>()

expenses.get('/api/expenses', async (c) => {
  const month = c.req.query('month')
  const stmt = month
    ? c.env.DB.prepare('SELECT * FROM expenses WHERE strftime("%Y-%m", date) = ? ORDER BY date DESC, id DESC').bind(month)
    : c.env.DB.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC')
  const { results } = await stmt.all()
  return c.json(results)
})

expenses.post('/api/expenses', async (c) => {
  const b = await c.req.json<ExpenseBody>()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(b.description, b.amount, b.date, b.paid_by, b.category, b.who_for, b.is_marriage_related ? 1 : 0, b.source ?? 'manual', b.raw_input ?? null).run()
  return c.json({ id: meta.last_row_id })
})

expenses.put('/api/expenses/:id', async (c) => {
  const b = await c.req.json<ExpenseBody>()
  await c.env.DB.prepare(
    'UPDATE expenses SET description=?,amount=?,date=?,paid_by=?,category=?,who_for=? WHERE id=?'
  ).bind(b.description, b.amount, b.date, b.paid_by, b.category, b.who_for, c.req.param('id')).run()
  return c.json({ ok: true })
})

expenses.delete('/api/expenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

expenses.post('/api/parse', async (c) => {
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

expenses.get('/api/export', async (c) => {
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

export default expenses
