import { Hono } from 'hono'
import { extractText, getDocumentProxy } from 'unpdf'
import type { Bindings, TxRow } from '../types'
import { makeLogger } from '../lib/log'


const statements = new Hono<{ Bindings: Bindings }>()

interface PageDoneEntry { page: number; model: string }
interface ProcessState {
  started_at: string
  pages: string[]
  pages_done?: (number | PageDoneEntry)[]
  page: number
  page_model_idx?: number
  progress?: string
  page_started_at?: string
  llm_status?: string
}

async function reconcileStatement(
  db: D1Database,
  openrouterKey: string,
  model: string,
  bank: string,
  text: string,
  payer: string,
  onStatus?: (msg: string) => Promise<void>
): Promise<{ total: number; matched: number; new_pending: number; skipped: number; skip_reason?: string }> {
  const today = new Date().toISOString().split('T')[0]
  const prompt = `Extract expense/debit transactions from this ${bank} statement. Today is ${today}.

RULES: Output ONLY raw JSON, no explanation, no markdown, no extra text.
Skip: bill payments, cash deposits, salary, interest, GST, bank fees, balance lines, cheque returns.
Include: purchases, UPI debits, refunds (negative amount).
If NOT a bank/CC statement (mutual fund, demat, insurance, FD, loan): {"skip":true,"reason":"not a bank/CC statement"}
If valid but no transactions: {"transactions":[]}

Text:
${text.slice(0, 4000)}

JSON schema (output nothing else):
{"transactions":[{"date":"YYYY-MM-DD","description":"Brand - item","amount":0.0,"category":"Food|Travel|Subscription|Shopping|Groceries|Medical|Utilities|Entertainment|EMI|Insurance|Personal Care|Rent|Other","who_for":"Prashant|Prayashi|Common"}]}`

  type LLMData = { choices?: { message?: { content?: string }; finish_reason?: string; error?: unknown }[]; error?: { message?: string }; code?: number }
  await onStatus?.(`trying: ${model}`)
  const t0 = Date.now()
  let llmData: LLMData = {}
  let lastErr = ''
  try {
    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(40000),
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://expense-tracker-4er.pages.dev',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      }),
    })
    const elapsed = Date.now() - t0
    llmData = await llmRes.json() as LLMData
    if (!llmRes.ok || llmData.error) {
      lastErr = `[${model}] HTTP ${llmRes.status} in ${elapsed}ms: ${llmData.error?.message ?? JSON.stringify(llmData).slice(0, 150)}`
    } else {
      const choice = llmData.choices?.[0]
      if (choice?.finish_reason === 'error') {
        lastErr = `[${model}] provider error in ${elapsed}ms: ${JSON.stringify(choice.error ?? '').slice(0, 100)}`
      } else if (!llmData.choices?.[0]?.message?.content) {
        lastErr = `[${model}] empty response in ${elapsed}ms: ${JSON.stringify(llmData).slice(0, 150)}`
      }
    }
  } catch (e: any) {
    const elapsed = Date.now() - t0
    lastErr = `[${model}] ${e?.name ?? 'error'} after ${elapsed}ms: ${String(e?.message ?? e).slice(0, 100)}`
  }
  await onStatus?.(lastErr || `[${model}] OK in ${Date.now() - t0}ms`)
  if (lastErr) return { total: 0, matched: 0, new_pending: 0, skipped: 0, skip_reason: lastErr }
  const content = llmData.choices![0].message!.content!
  const cleaned = content.replace(/```json\n?|```/g, '').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  const toParse = jsonMatch ? jsonMatch[0] : cleaned
  let parsed: { transactions?: TxRow[]; skip?: boolean; reason?: string }
  try {
    parsed = JSON.parse(toParse)
  } catch {
    // Try to salvage individual transaction objects via regex
    const salvaged: TxRow[] = []
    for (const m of toParse.matchAll(/\{[^{}]*"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"[^{}]*"amount"\s*:\s*([\d.]+)[^{}]*\}/g)) {
      try { salvaged.push(JSON.parse(m[0])) } catch { /* skip malformed */ }
    }
    if (salvaged.length) {
      parsed = { transactions: salvaged }
    } else if (content.length > 500) {
      // Substantial content but unparseable — ask LLM to repair it
      try {
        const repairRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://expense-tracker-4er.pages.dev' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: `Fix this malformed JSON and return only valid JSON, nothing else:\n${content.slice(0, 3000)}` }],
            response_format: { type: 'json_object' },
            max_tokens: 4000,
          }),
        })
        const repairData = await repairRes.json() as { choices?: { message?: { content?: string } }[] }
        const repairContent = repairData.choices?.[0]?.message?.content ?? ''
        try { parsed = JSON.parse(repairContent) } catch { throw new Error(`LLM parse failed (repair also failed): ${content.slice(0, 200)}`) }
      } catch (e: any) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') throw new Error(`LLM repair timed out (20s)`)
        throw e
      }
    } else {
      throw new Error(`LLM parse failed: ${content.slice(0, 200)}`)
    }
  }

  if (parsed.skip) return { total: 0, matched: 0, new_pending: 0, skipped: 0, skip_reason: parsed.reason ?? 'not a bank/CC statement' }

  const transactions = parsed.transactions ?? []
  let matched = 0, newPending = 0, skipped = 0

  const validWhoFor = new Set(['Prashant', 'Prayashi', 'Common'])
  for (const tx of transactions) {
    if (!tx.date || tx.amount == null || !tx.description) { skipped++; continue }
    if (!validWhoFor.has(tx.who_for)) tx.who_for = 'Common'

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

  const pdfBuffer = await fetch(`data:application/octet-stream;base64,${pdf_base64.replace(/[\s]/g, '')}`).then(r => r.arrayBuffer())
  const pdfBytes = new Uint8Array(pdfBuffer)
  if (!pdfBytes.length) return c.json({ error: 'pdf_base64 decoded to empty — invalid base64 input' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      'INSERT INTO pending_statements (bank, filename, paid_by, pdf_data, email_date) VALUES (?,?,?,?,?)'
    ).bind(bank, filename ?? null, paid_by ?? 'Prashant', pdfBuffer, email_date ?? null).run()
    return c.json({ queued: true, id: meta.last_row_id, bank, filename })
  } catch (dbErr: any) {
    return c.json({ error: `D1 store failed: ${String(dbErr?.message ?? dbErr)} (${pdfBytes.length} bytes)` }, 500)
  }
})

statements.post('/api/statement-upload-manual', async (c) => {
  const { bank, pdf_base64, paid_by, filename } = await c.req.json<{
    bank: string; pdf_base64: string; paid_by?: string; filename?: string
  }>()
  if (!pdf_base64) return c.json({ error: 'pdf_base64 required' }, 400)

  const pdfBuffer = await fetch(`data:application/octet-stream;base64,${pdf_base64.replace(/[\s]/g, '')}`).then(r => r.arrayBuffer())
  const pdfBytes = new Uint8Array(pdfBuffer)
  if (!pdfBytes.length) return c.json({ error: 'pdf_base64 decoded to empty' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      'INSERT INTO pending_statements (bank, filename, paid_by, pdf_data) VALUES (?,?,?,?)'
    ).bind(bank?.trim() || 'Unknown', filename ?? null, paid_by ?? 'Prashant', pdfBuffer).run()
    return c.json({ queued: true, id: meta.last_row_id })
  } catch (dbErr: any) {
    return c.json({ error: `Store failed: ${String(dbErr?.message ?? dbErr)}` }, 500)
  }
})

statements.get('/api/pending-statements', async (c) => {
  // TTL: hard-delete processed/rejected rows older than 1 year
  await c.env.DB.prepare(
    "DELETE FROM pending_statements WHERE unlock_status='processed' AND processed_at < datetime('now', '-1 year')"
  ).run()
  const { results } = await c.env.DB.prepare(
    "SELECT id, bank, filename, paid_by, email_date, unlock_status, unlock_result, created_at FROM pending_statements WHERE unlock_status NOT IN ('processed','rejected') ORDER BY created_at DESC"
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
    const existing = row.unlock_result ? (JSON.parse(row.unlock_result) as ProcessState) : null
    const elapsed = existing?.started_at ? Date.now() - new Date(existing.started_at).getTime() : Infinity
    if (elapsed > 50 * 1000) {
      const failResult: Record<string, unknown> = { error: 'Processing timed out — please retry' }
      if (existing?.pages) {
        failResult.pages = existing.pages
        failResult.pages_done = existing.pages_done ?? []
        failResult.page_model_idx = existing.page_model_idx ?? 0
        if (existing.page !== undefined) failResult.page = existing.page
        if (existing.llm_status) failResult.last_llm_status = existing.llm_status
        if (existing.progress) failResult.progress = existing.progress
      }
      await c.env.DB.prepare(
        "UPDATE pending_statements SET unlock_status='failed', unlock_result=? WHERE id=?"
      ).bind(JSON.stringify(failResult), id).run()
      return c.json({ status: 'failed', result: { error: 'Processing timed out — please retry', has_pages: !!existing?.pages, last_llm_status: existing?.llm_status ?? null } })
    }
  }

  let result: Record<string, unknown> | null = null
  if (row.unlock_result) {
    const parsed = JSON.parse(row.unlock_result) as ProcessState & Record<string, unknown>
    const { pages: _pages, pages_done: _pagesDone, ...rest } = parsed
    rest.has_pages = !!(_pages as unknown[])?.length
    if (rest.page_started_at) {
      rest.page_elapsed_s = Math.round((Date.now() - new Date(rest.page_started_at as string).getTime()) / 1000)
    }
    if (rest.llm_started_at) {
      rest.llm_elapsed_s = Math.round((Date.now() - new Date(rest.llm_started_at as string).getTime()) / 1000)
    }
    result = rest
  }
  return c.json({ status: row.unlock_status, result })
})

statements.get('/api/pending-statements/:id/text', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT bank, filename, paid_by, unlock_status, unlock_result FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  const row = results[0] as { bank: string; filename: string; paid_by: string; unlock_status: string; unlock_result: string | null }
  if (!row.unlock_result) return c.json({ error: 'PDF not yet extracted — approve it first' }, 400)
  let state: { pages?: string[] } = {}
  try { state = JSON.parse(row.unlock_result) } catch {}
  if (!state.pages?.length) return c.json({ error: 'No pages extracted yet' }, 400)
  return c.json({
    id: parseInt(id),
    bank: row.bank,
    filename: row.filename,
    paid_by: row.paid_by,
    page_count: state.pages.length,
    pages: state.pages,
    full_text: state.pages.join('\n\n--- PAGE BREAK ---\n\n'),
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

async function extractPdfText(pdfBytes: Uint8Array, password: string): Promise<string[]> {
  try {
    const pdfDoc = await getDocumentProxy(pdfBytes, { password })
    const { text: pages } = await extractText(pdfDoc, { mergePages: false })
    return (pages as string[]).slice(0, 12)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.toLowerCase().includes('password') || e?.name === 'PasswordException') throw new Error('Wrong password')
    throw new Error(`PDF extraction failed: ${msg}`)
  }
}

statements.post('/api/pending-statements/:id/unlock', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }))
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  const { results } = await c.env.DB.prepare(
    'SELECT id, bank, paid_by, pdf_data, unlock_status FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)

  const row = results[0] as { bank: string; unlock_status: string }
  if (row.unlock_status === 'processing') return c.json({ error: 'Already processing' }, 409)

  let passwords: Record<string, string> = {}
  try { passwords = JSON.parse(c.env.PDF_PASSWORDS ?? '{}') } catch {}
  const password = body.password || passwords[row.bank] || ''

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
      body: JSON.stringify({ password, stage: 'extract' }),
    })
  )

  return c.json({ accepted: true }, 202)
})

// Retry processing without password — uses already-extracted pages stored in DB
statements.post('/api/pending-statements/:id/retry', async (c) => {
  const id = c.req.param('id')
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'OPENROUTER_API_KEY not set' }, 500)

  const { results } = await c.env.DB.prepare(
    'SELECT unlock_status, unlock_result FROM pending_statements WHERE id=?'
  ).bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)

  const row = results[0] as { unlock_status: string; unlock_result: string | null }
  if (row.unlock_status === 'processing') return c.json({ error: 'Already processing' }, 409)
  if (!['failed', 'extracted'].includes(row.unlock_status)) return c.json({ error: `Cannot retry from status: ${row.unlock_status}` }, 400)

  let state: Partial<ProcessState> = {}
  try { state = JSON.parse(row.unlock_result ?? '{}') } catch {}
  if (!state.pages?.length) return c.json({ error: 'No extracted pages — unlock with password first' }, 400)

  // Exclude exhausted pages from doneIndices so they get re-attempted on retry
  const doneIndices = new Set(
    (state.pages_done ?? [])
      .filter(e => !(typeof e === 'object' && (e as PageDoneEntry).model === 'exhausted'))
      .map(e => typeof e === 'number' ? e : (e as PageDoneEntry).page)
  )
  const nextPage = state.pages.findIndex((_, i) => !doneIndices.has(i))
  if (nextPage === -1) return c.json({ error: 'All pages already processed' }, 400)

  // Preserve page_model_idx if retrying the same page, reset to 0 for a new page
  const pageModelIdx = nextPage === state.page ? (state.page_model_idx ?? 0) : 0

  await c.env.DB.prepare(
    "UPDATE pending_statements SET unlock_status='processing', unlock_result=? WHERE id=?"
  ).bind(JSON.stringify({ started_at: new Date().toISOString(), pages: state.pages, pages_done: state.pages_done ?? [], page: nextPage, page_model_idx: pageModelIdx }), id).run()

  const origin = new URL(c.req.url).origin
  c.executionCtx.waitUntil(
    fetch(`${origin}/api/pending-statements/${id}/process-async`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.INGEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ stage: 'reconcile', page: nextPage }),
    })
  )

  return c.json({ accepted: true }, 202)
})

statements.post('/api/pending-statements/:id/process-async', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json<{ password?: string; stage?: string; page?: number }>()
  const origin = new URL(c.req.url).origin
  const log = makeLogger(c.env.LOG_LEVEL)

  log.debug(`[process-async] id=${id} stage=${body.stage ?? 'extract'} page=${body.page ?? 0} origin=${origin}`)

  const failWith = async (msg: string, preserveState?: ProcessState) => {
    log.error(`[process-async] FAIL id=${id}: ${msg}`)
    const result: Record<string, unknown> = { error: msg }
    if (preserveState?.pages) { result.pages = preserveState.pages; result.pages_done = preserveState.pages_done ?? [] }
    await c.env.DB.prepare("UPDATE pending_statements SET unlock_status='failed', unlock_result=? WHERE id=?")
      .bind(JSON.stringify(result), id).run()
  }

  // Stage 1: extract PDF text, store page texts, chain to reconcile stage
  if (!body.stage || body.stage === 'extract') {
    const { results } = await c.env.DB.prepare(
      'SELECT bank, paid_by, pdf_data FROM pending_statements WHERE id=?'
    ).bind(id).all()
    if (!results.length) return c.json({ error: 'Not found' }, 404)

    const row = results[0] as { bank: string; paid_by: string; pdf_data: unknown }

    let pages: string[]
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF extraction timed out after 22s')), 22000)
      )
      const pdfBytes = await normalisePdfData(row.pdf_data)
      if (!pdfBytes) { await failWith('Stored PDF is empty'); return c.json({ ok: true }) }
      log.debug(`[process-async] extracting PDF id=${id} bytes=${pdfBytes.length}`)
      pages = await Promise.race([extractPdfText(pdfBytes, body.password!), timeout])
      log.debug(`[process-async] extracted ${pages.length} pages id=${id}`)
    } catch (e: any) {
      await failWith(String(e?.message ?? e))
      return c.json({ ok: true })
    }

    await c.env.DB.prepare(
      "UPDATE pending_statements SET unlock_status='extracted', unlock_result=? WHERE id=?"
    ).bind(JSON.stringify({ pages, pages_done: [], page: 0 }), id).run()
    log.debug(`[process-async] extracted ${pages.length} pages id=${id}, ready for ChatGPT`)
    return c.json({ ok: true })
  }

  // Stage 2: process one page at a time via LLM
  if (body.stage === 'reconcile') {
    const { results } = await c.env.DB.prepare(
      'SELECT bank, paid_by, unlock_status, unlock_result FROM pending_statements WHERE id=?'
    ).bind(id).all()
    if (!results.length) { log.debug(`[process-async] reconcile id=${id} not found — already deleted?`); return c.json({ ok: true }) }

    const row = results[0] as { bank: string; paid_by: string; unlock_status: string; unlock_result: string }
    if (row.unlock_status !== 'processing') { log.debug(`[process-async] reconcile id=${id} status=${row.unlock_status} — cancelled or reset, bailing`); return c.json({ ok: true }) }
    let state: ProcessState
    try { state = JSON.parse(row.unlock_result) } catch { await failWith('Corrupt state'); return c.json({ ok: true }) }

    const MODEL_LIST = [
      // 'openrouter/free',
      // 'google/gemma-4-31b-it:free',
      c.env.LLM_MODEL ?? 'openai/gpt-oss-120b:free',
    ]
    const pageIdx = body.page ?? 0
    const pageText = state.pages[pageIdx]
    const meaningfulPage = pageText && pageText.replace(/\s/g, '').length > 100
    const pageModelIdx = state.page_model_idx ?? 0
    const pageStartedAt = new Date().toISOString()
    const progress = `page ${pageIdx + 1}/${state.pages.length}`

    const writeState = (extra: Record<string, unknown> = {}) =>
      c.env.DB.prepare("UPDATE pending_statements SET unlock_result=? WHERE id=?")
        .bind(JSON.stringify({ started_at: pageStartedAt, pages: state.pages, pages_done: state.pages_done ?? [], page: pageIdx, page_model_idx: pageModelIdx, progress, page_started_at: pageStartedAt, ...extra }), id).run()

    await writeState()
    log.debug(`[process-async] reconcile id=${id} page=${pageIdx} model_idx=${pageModelIdx}/${MODEL_LIST.length - 1} chars=${pageText?.length ?? 0}`)

    // All models exhausted for this page — reset to model 0 and wait for auto-retry (don't skip pages with content)
    if (pageModelIdx >= MODEL_LIST.length) {
      log.debug(`[process-async] page=${pageIdx} all models exhausted, cycling back to model 0`)
      await writeState({ llm_status: `all models exhausted, cycling back to model 0` })
      await c.env.DB.prepare("UPDATE pending_statements SET unlock_result=json_set(unlock_result,'$.page_model_idx',0) WHERE id=?")
        .bind(id).run()
      return c.json({ ok: true })
    }

    let llmSucceeded = false
    let successModel = 'skip'
    if (meaningfulPage) {
      const attemptModel = MODEL_LIST[pageModelIdx]
      const onStatus = async (msg: string) => {
        log.debug(`[process-async] id=${id} page=${pageIdx} model=${attemptModel}: ${msg}`)
        await writeState({ llm_status: msg })
      }
      try {
        const result = await reconcileStatement(
          c.env.DB, c.env.OPENROUTER_API_KEY, attemptModel,
          row.bank, pageText, row.paid_by, onStatus
        )
        if (!result.skip_reason) {
          llmSucceeded = true
          successModel = attemptModel
          log.debug(`[process-async] page=${pageIdx} model=${attemptModel} OK: total=${result.total} new=${result.new_pending}`)
        } else {
          log.debug(`[process-async] page=${pageIdx} model=${attemptModel} skip: ${result.skip_reason}`)
        }
      } catch (e: any) {
        log.error(`[process-async] page=${pageIdx} model=${attemptModel} threw: ${String(e?.message ?? e).slice(0, 200)}`)
      }
    } else {
      // Not meaningful — skip without LLM
      llmSucceeded = true
    }

    if (llmSucceeded) {
      // Page done (success or meaningless) — move to next page, reset model idx
      const newPagesDone = [...(state.pages_done ?? []), { page: pageIdx, model: successModel }]
      return await chainNext(pageIdx, newPagesDone, 0)
    } else {
      // LLM failed/timed out — write incremented model idx, let auto-retry try next model
      await writeState({ llm_status: `model ${pageModelIdx} failed, next retry will try model ${pageModelIdx + 1}` })
      await c.env.DB.prepare("UPDATE pending_statements SET unlock_result=json_set(unlock_result,'$.page_model_idx',?) WHERE id=?")
        .bind(pageModelIdx + 1, id).run()
      log.debug(`[process-async] page=${pageIdx} model_idx now ${pageModelIdx + 1}, waiting for auto-retry`)
    }

    return c.json({ ok: true })

    async function chainNext(donePageIdx: number, newPagesDone: (number | PageDoneEntry)[], nextModelIdx: number) {
      const nextPage = donePageIdx + 1
      if (nextPage < state.pages.length) {
        const subrequestUrl = `${origin}/api/pending-statements/${id}/process-async`
        log.debug(`[process-async] chaining to page=${nextPage}`)
        await c.env.DB.prepare("UPDATE pending_statements SET unlock_result=? WHERE id=?")
          .bind(JSON.stringify({ started_at: new Date().toISOString(), pages: state.pages, pages_done: newPagesDone, page: nextPage, page_model_idx: nextModelIdx, progress: `page ${nextPage + 1}/${state.pages.length}` }), id).run()
        const subreq = fetch(subrequestUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.env.INGEST_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'reconcile', page: nextPage }),
        })
        subreq.catch(e => log.error(`[process-async] subrequest reconcile/${nextPage} FAILED: ${e?.message}`))
        c.executionCtx.waitUntil(subreq)
      } else {
        log.debug(`[process-async] all pages done id=${id}, marking processed`)
        await c.env.DB.prepare("UPDATE pending_statements SET unlock_status='processed', processed_at=datetime('now'), unlock_result=NULL WHERE id=?").bind(id).run()
      }
      return c.json({ ok: true })
    }
  }

  return c.json({ error: 'unknown stage' }, 400)
})

statements.post('/api/pending-statements/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare('SELECT unlock_status, unlock_result FROM pending_statements WHERE id=?').bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  const row = results[0] as { unlock_status: string; unlock_result: string | null }
  let state: { pages?: string[]; pages_done?: unknown[] } = {}
  try { state = JSON.parse(row.unlock_result ?? '{}') } catch {}
  if (state.pages?.length) {
    await c.env.DB.prepare("UPDATE pending_statements SET unlock_status='extracted', unlock_result=? WHERE id=?")
      .bind(JSON.stringify({ pages: state.pages, pages_done: state.pages_done ?? [], page: 0 }), id).run()
  } else {
    await c.env.DB.prepare("UPDATE pending_statements SET unlock_status='failed', unlock_result='{\"error\":\"Cancelled\"}' WHERE id=?").bind(id).run()
  }
  return c.json({ ok: true })
})

statements.post('/api/pending-statements/:id/mark-processed', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare('SELECT id FROM pending_statements WHERE id=?').bind(id).all()
  if (!results.length) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare("UPDATE pending_statements SET unlock_status='processed', processed_at=datetime('now'), unlock_result=NULL WHERE id=?").bind(id).run()
  return c.json({ ok: true })
})

statements.delete('/api/pending-statements/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM pending_statements WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default statements
