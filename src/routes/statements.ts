import { Hono } from 'hono'
import { extractText, getDocumentProxy } from 'unpdf'
import type { Bindings, TxRow } from '../types'


const statements = new Hono<{ Bindings: Bindings }>()

async function reconcileStatement(
  db: D1Database,
  openrouterKey: string,
  model: string,
  bank: string,
  text: string,
  payer: string
): Promise<{ total: number; matched: number; new_pending: number; skipped: number; skip_reason?: string }> {
  const today = new Date().toISOString().split('T')[0]
  const prompt = `Extract all expense/debit transactions from this ${bank} bank or credit card statement. Today is ${today}.

Statement text:
"""
${text.slice(0, 8000)}
"""

Return ONLY valid JSON: {"transactions": [...]}

Each transaction:
{
  "date": "YYYY-MM-DD",
  "description": "normalize to 'Brand - item' (e.g. 'Zomato - order', 'Amazon - order', 'Swiggy - order')",
  "amount": <positive for debits/purchases, negative for refunds/reversals>,
  "category": "<Food|Travel|Subscription|Shopping|Groceries|Medical|Utilities|Entertainment|EMI|Insurance|Personal Care|Rent|Other>",
  "who_for": "<Prashant|Prayashi|Common>"
}

Skip: credit card bill payments, cash deposits, salary credits, interest charges, GST, bank fees, opening/closing balance, cheque returns.
Include: all purchases, UPI debits, refunds (negative amount).

IMPORTANT: If this document is NOT a credit card statement or bank account statement — e.g. it is a mutual fund statement, demat/holdings statement, stock portfolio statement, insurance statement, fixed deposit statement, loan account statement, or any investment account statement — return {"skip": true, "reason": "not a bank/CC statement"}.

Return {"transactions": []} if it is a valid bank/CC statement but no qualifying transactions found.`

  const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://expense-tracker-4er.pages.dev',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  })

  const llmData = await llmRes.json() as { choices?: { message?: { content?: string } }[] }
  const content = llmData.choices?.[0]?.message?.content
  let parsed: { transactions?: TxRow[]; skip?: boolean; reason?: string }
  try { parsed = JSON.parse(content ?? '') } catch { throw new Error(`LLM parse failed: ${content?.slice(0, 200)}`) }

  if (parsed.skip) return { total: 0, matched: 0, new_pending: 0, skipped: 0, skip_reason: parsed.reason ?? 'not a bank/CC statement' }

  const transactions = parsed.transactions ?? []
  let matched = 0, newPending = 0, skipped = 0

  for (const tx of transactions) {
    if (!tx.date || tx.amount == null || !tx.description) { skipped++; continue }

    const { results: dup } = await db.prepare(`
      SELECT id FROM expenses
      WHERE ABS(amount - ?) < 0.01
        AND date(date) BETWEEN date(?, '-3 days') AND date(?, '+3 days')
      UNION
      SELECT id FROM pending_expenses
      WHERE ABS(amount - ?) < 0.01
        AND date(date) BETWEEN date(?, '-3 days') AND date(?, '+3 days')
        AND status != 'rejected'
    `).bind(tx.amount, tx.date, tx.date, tx.amount, tx.date, tx.date).all()

    if (dup.length) { matched++; continue }

    await db.prepare(
      'INSERT INTO pending_expenses (description,amount,date,paid_by,category,who_for,is_marriage_related,source,raw_input) VALUES (?,?,?,?,?,?,0,?,?)'
    ).bind(
      tx.description, tx.amount, tx.date, payer,
      tx.category ?? 'Other', tx.who_for ?? 'Common',
      `statement_${bank}`, text.slice(0, 500)
    ).run()
    newPending++
  }

  await db.prepare(
    'INSERT INTO statement_imports (bank, total_transactions, matched, new_pending) VALUES (?,?,?,?)'
  ).bind(bank, transactions.length, matched, newPending).run()

  return { total: transactions.length, matched, new_pending: newPending, skipped }
}

statements.post('/api/statement-ingest', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const { bank, text, paid_by } = await c.req.json<{ bank: string; text: string; paid_by?: string }>()
  if (!text?.trim()) return c.json({ error: 'text required' }, 400)
  if (!bank?.trim()) return c.json({ error: 'bank required' }, 400)
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  try {
    const result = await reconcileStatement(
      c.env.DB, c.env.OPENROUTER_API_KEY,
      c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
      bank, text, paid_by ?? 'Prashant'
    )
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

statements.post('/api/statement-upload', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const { bank, pdf_base64, paid_by, filename, email_date } = await c.req.json<{
    bank: string; pdf_base64: string; paid_by?: string; filename?: string; email_date?: string
  }>()
  if (!pdf_base64) return c.json({ error: 'pdf_base64 required' }, 400)
  if (!bank?.trim()) return c.json({ error: 'bank required' }, 400)
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  let passwords: Record<string, string> = {}
  try { passwords = JSON.parse(c.env.PDF_PASSWORDS ?? '{}') } catch {}
  const password = passwords[bank] ?? ''

  const pdfBuffer = await fetch(`data:application/octet-stream;base64,${pdf_base64.replace(/[\s]/g, '')}`).then(r => r.arrayBuffer())
  const pdfStorageCopy = pdfBuffer.slice(0)
  const pdfBytes = new Uint8Array(pdfBuffer)
  if (!pdfBytes.length) return c.json({ error: 'pdf_base64 decoded to empty — invalid base64 input' }, 400)

  let text: string
  try {
    const pdfDoc = await getDocumentProxy(pdfBytes, password ? { password } : {})
    const { text: pages } = await extractText(pdfDoc)
    text = pages.join('\n')
  } catch (e: any) {
    const isPasswordError = e?.name === 'PasswordException' || String(e?.message ?? e).toLowerCase().includes('password')
    if (isPasswordError) {
      try {
        const { meta } = await c.env.DB.prepare(
          'INSERT INTO pending_statements (bank, filename, paid_by, pdf_data, email_date) VALUES (?,?,?,?,?)'
        ).bind(bank, filename ?? null, paid_by ?? 'Prashant', pdfStorageCopy, email_date ?? null).run()
        return c.json({ password_required: true, id: meta.last_row_id, bank, filename })
      } catch (dbErr: any) {
        return c.json({ error: `PDF needs password - D1 store failed: ${String(dbErr?.message ?? dbErr)} (${pdfBytes.length} bytes)` }, 400)
      }
    }
    return c.json({ error: `PDF extraction failed: ${String(e?.message ?? e)}` }, 500)
  }

  if (!text.trim()) return c.json({ error: 'No text extracted from PDF (scanned image PDF?)' }, 400)

  try {
    const result = await reconcileStatement(
      c.env.DB, c.env.OPENROUTER_API_KEY,
      c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
      bank, text, paid_by ?? 'Prashant'
    )
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

statements.get('/api/pending-statements', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, bank, filename, paid_by, email_date, unlock_status, unlock_result, created_at FROM pending_statements ORDER BY created_at DESC'
  ).all()
  return c.json(results)
})

statements.get('/api/pending-statements/:id/status', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT unlock_status, unlock_result FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ status: 'done' })
  const row = results[0] as { unlock_status: string; unlock_result: string | null }

  // Auto-reset if stuck in processing > 5 minutes
  if (row.unlock_status === 'processing') {
    const startedAt = row.unlock_result ? (JSON.parse(row.unlock_result) as { started_at?: string }).started_at : null
    const elapsed = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity
    if (elapsed > 5 * 60 * 1000) {
      const errResult = JSON.stringify({ error: 'Processing timed out — please retry' })
      await c.env.DB.prepare(
        "UPDATE pending_statements SET unlock_status='failed', unlock_result=? WHERE id=?"
      ).bind(errResult, id).run()
      return c.json({ status: 'failed', result: { error: 'Processing timed out — please retry' } })
    }
  }

  return c.json({
    status: row.unlock_status,
    result: row.unlock_result ? JSON.parse(row.unlock_result) : null,
  })
})

async function normalisePdfData(raw: unknown): Promise<Uint8Array | null> {
  let arr: number[]
  if (raw instanceof ArrayBuffer) {
    arr = Array.from(new Uint8Array(raw))
  } else if (typeof raw === 'string') {
    const buf = await fetch(`data:application/octet-stream;base64,${raw.replace(/[\s]/g, '')}`).then(r => r.arrayBuffer())
    arr = Array.from(new Uint8Array(buf))
  } else if (raw && typeof raw === 'object') {
    arr = Array.from(Object.values(raw as Record<string, number>))
  } else {
    return null
  }
  return arr.length ? new Uint8Array(arr) : null
}

async function processUnlock(
  db: D1Database,
  openrouterKey: string,
  model: string,
  id: string,
  row: { bank: string; paid_by: string; pdf_data: unknown },
  password: string,
): Promise<void> {
  try {
    const pdfBytes = await normalisePdfData(row.pdf_data)
    if (!pdfBytes) throw new Error('Stored PDF is empty — reject and re-run backfill')

    let text: string
    try {
      const pdfDoc = await getDocumentProxy(pdfBytes, { password })
      const { text: pages } = await extractText(pdfDoc)
      text = pages.join('\n')
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (msg.toLowerCase().includes('password') || e?.name === 'PasswordException') {
        throw new Error('Wrong password')
      }
      throw new Error(`PDF extraction failed: ${msg}`)
    }

    if (!text.trim()) throw new Error('No text extracted from PDF')

    await reconcileStatement(db, openrouterKey, model, row.bank, text, row.paid_by)
    await db.prepare('DELETE FROM pending_statements WHERE id=?').bind(id).run()
  } catch (e: any) {
    try {
      await db.prepare(
        "UPDATE pending_statements SET unlock_status='failed', unlock_result=? WHERE id=?"
      ).bind(JSON.stringify({ error: String(e?.message ?? e) }), id).run()
    } catch { /* D1 write failed — status endpoint will timeout-reset after 5 min */ }
  }
}

statements.post('/api/pending-statements/:id/unlock', async (c) => {
  const id = c.req.param('id')
  const { password } = await c.req.json<{ password: string }>()
  if (!password) return c.json({ error: 'password required' }, 400)
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  const { results } = await c.env.DB.prepare(
    'SELECT id, bank, paid_by, pdf_data, unlock_status FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)

  const row = results[0] as { unlock_status: string }
  if (row.unlock_status === 'processing') return c.json({ error: 'Already processing' }, 409)

  await c.env.DB.prepare(
    "UPDATE pending_statements SET unlock_status='processing', unlock_result=? WHERE id=?"
  ).bind(JSON.stringify({ started_at: new Date().toISOString() }), id).run()

  const origin = new URL(c.req.url).origin
  c.executionCtx.waitUntil(
    fetch(`${origin}/api/pending-statements/${id}/process-async`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.INGEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    })
  )

  return c.json({ accepted: true }, 202)
})

statements.post('/api/pending-statements/:id/process-async', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const id = c.req.param('id')
  const { password } = await c.req.json<{ password: string }>()

  const { results } = await c.env.DB.prepare(
    'SELECT id, bank, paid_by, pdf_data FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)

  const row = results[0] as { bank: string; paid_by: string; pdf_data: unknown }
  await processUnlock(c.env.DB, c.env.OPENROUTER_API_KEY, c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free', id, row, password)

  return c.json({ ok: true })
})

statements.delete('/api/pending-statements/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM pending_statements WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default statements
