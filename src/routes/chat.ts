import { Hono } from 'hono'
import type { Bindings } from '../types'

const chat = new Hono<{ Bindings: Bindings }>()

chat.get('/api/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT category FROM expenses ORDER BY category ASC'
  ).all() as { results: { category: string }[] }
  const fromDb = results.map(r => r.category)
  const defaults = ['Food','Travel','Subscription','Shopping','Rent','Medical','Entertainment','Utilities','Groceries','Education','Insurance','EMI','Personal Care','Gifts','Other']
  const all = [...new Set([...defaults, ...fromDb])].sort()
  return c.json(all)
})

chat.post('/api/chat', async (c) => {
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'No API key' }, 500)
  const { month, messages } = await c.req.json<{ month?: string; messages: { role: string; content: string }[] }>()

  const stmt = month
    ? c.env.DB.prepare('SELECT * FROM expenses WHERE strftime("%Y-%m", date) = ? ORDER BY date ASC').bind(month)
    : c.env.DB.prepare('SELECT * FROM expenses ORDER BY date ASC')
  const { results } = await stmt.all() as { results: Record<string, unknown>[] }

  const total = results.reduce((s, e) => s + (e.amount as number), 0)
  const byCat: Record<string, number> = {}
  results.forEach(e => { const k = e.category as string; byCat[k] = (byCat[k] || 0) + (e.amount as number) })
  const cmnP = results.filter(e => e.who_for === 'Common' && e.paid_by === 'Prashant').reduce((s, e) => s + (e.amount as number), 0)
  const cmnQ = results.filter(e => e.who_for === 'Common' && e.paid_by === 'Prayashi').reduce((s, e) => s + (e.amount as number), 0)
  const topTxns = (results as Record<string, unknown>[])
    .sort((a, b) => Math.abs(b.amount as number) - Math.abs(a.amount as number))
    .slice(0, 30)
    .map(e => `${e.date} ${e.description} ₹${e.amount} [${e.category}, ${e.paid_by}, for ${e.who_for}]`)
    .join('\n')

  const systemPrompt = `You are a personal finance analyst for Prashant & Prayashi. Be concise and direct. Answer questions about their expenses.

Data for ${month ?? 'all time'}:
- Total: ₹${total.toFixed(0)} across ${results.length} transactions
- By category: ${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ₹${v.toFixed(0)}`).join(', ')}
- Common expenses: Prashant paid ₹${cmnP.toFixed(0)}, Prayashi paid ₹${cmnQ.toFixed(0)}
- Settlement: ${Math.abs((cmnP-cmnQ)/2) < 1 ? 'Settled' : (cmnP > cmnQ ? `Prayashi owes Prashant ₹${((cmnP-cmnQ)/2).toFixed(0)}` : `Prashant owes Prayashi ₹${((cmnQ-cmnP)/2).toFixed(0)}`)}

Top transactions:
${topTxns}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker-4er.pages.dev',
    },
    body: JSON.stringify({
      model: c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
    }),
  })

  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})

chat.get('/api/analyze', async (c) => {
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

chat.get('/api/openapi.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'Expense Tracker',
      version: '1.0.0',
      description: 'Personal expense tracker for Prashant & Prayashi. paid_by: Prashant or Prayashi. who_for: Prashant, Prayashi, or Common (Common = split equally). category: open-ended string — use common ones (Food, Travel, Subscription, Shopping, Rent, Medical, Entertainment, Utilities, Groceries, Education, Insurance, EMI, Personal Care, Gifts) or create a new one if none fit.',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
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
            category: { type: 'string', description: 'Expense category — free text, any string is accepted.' },
            who_for: { type: 'string', enum: ['Prashant', 'Prayashi', 'Common'], description: '"Common" means split equally between both' },
            raw_input: { type: 'string', description: 'Exact original text the user said or typed — store verbatim' },
            force: { type: 'boolean', description: 'Set to true to bypass duplicate detection and save anyway. Only use after receiving a 409 duplicate_detected error.' },
          },
        },
      },
    },
    paths: {
      '/api/categories': { get: { operationId: 'listCategories', summary: 'List all known expense categories', responses: { '200': { description: 'Sorted array of category strings', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } },
      '/api/expenses': {
        get: { operationId: 'listExpenses', summary: 'List expenses for a month', parameters: [{ name: 'month', in: 'query', schema: { type: 'string' }, description: 'YYYY-MM format' }], responses: { '200': { description: 'Array of expenses', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Expense' } } } } } } },
        post: { operationId: 'addExpense', summary: 'Add a new expense. Returns 409 if a duplicate amount exists in the same month — read the message field, confirm with user, then retry with "force": true to override.', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExpenseInput' } } } }, responses: { '200': { description: 'Created with id' }, '409': { description: 'Duplicate detected — response includes existing transaction details and instructions to override with force:true' } } },
      },
      '/api/expenses/{id}': {
        put: { operationId: 'editExpense', summary: 'Edit an existing expense by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExpenseInput' } } } }, responses: { '200': { description: 'Updated' } } },
        delete: { operationId: 'deleteExpense', summary: 'Delete an expense by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Deleted' } } },
      },
      '/api/pending': {
        get: { operationId: 'listPending', summary: 'List pending expenses awaiting review', responses: { '200': { description: 'Array of pending expenses', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Expense' } } } } } } },
        post: { operationId: 'addPending', summary: 'Add an expense to the pending review queue — use this after parsing a bank statement', requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/ExpenseInput' } } } }, responses: { '200': { description: 'Created with id' } } },
      },
      '/api/pending/{id}/approve': { post: { operationId: 'approvePending', summary: 'Approve a pending expense. Returns 409 if a duplicate amount exists in the same month — read the message field, confirm with user, then retry with "force": true to override.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { required: false, content: { 'application/json': { schema: { '$ref': '#/components/schemas/ExpenseInput' } } } }, responses: { '200': { description: 'Approved' }, '409': { description: 'Duplicate detected — response includes existing transaction details and instructions to override with force:true' } } } },
      '/api/pending/{id}': { delete: { operationId: 'rejectPending', summary: 'Reject and discard a pending expense', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Rejected' } } } },
      '/api/pending-emails': { get: { operationId: 'listPendingEmails', summary: 'List raw emails queued for parsing — fetch these, extract expense transactions, add via addPending, then mark each done via markEmailProcessed', responses: { '200': { description: 'Array of pending emails with id, source, paid_by, received_date, created_at, preview (first 200 chars)' } } } },
      '/api/pending-emails/{id}': {
        get: { operationId: 'getEmailText', summary: 'Get full raw text of a single pending email — use this to read the complete email content before parsing', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Full email with raw_text field' } } },
        delete: { operationId: 'markEmailProcessed', summary: 'Mark a pending email as processed — call this after adding all transactions from that email via addPending', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Marked processed' } } },
      },
      '/api/pending-statements': { get: { operationId: 'listPendingStatements', summary: 'List PDF bank statements pending processing', responses: { '200': { description: 'Array of pending statements with id, bank, filename, paid_by, unlock_status' } } } },
      '/api/pending-statements/{id}/text': { get: { operationId: 'getStatementText', summary: 'Get extracted text from a PDF statement — call this to get the raw content, then parse transactions and add via addPending', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Statement text with pages array and full_text joined string' } } } },
      '/api/pending-statements/{id}/mark-processed': { post: { operationId: 'markStatementProcessed', summary: 'Mark a PDF statement as processed — call this after all transactions have been added via addPending', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Marked as processed, hidden from list' } } } },
    },
  })
})

export default chat
