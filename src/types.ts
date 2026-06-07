export type Bindings = {
  DB: D1Database
  OPENROUTER_API_KEY: string
  LLM_MODEL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  INGEST_TOKEN: string
  API_KEY: string
  PDF_PASSWORDS: string
}

export interface ExpenseBody {
  description: string
  amount: number
  date: string
  paid_by: string
  category: string
  who_for: string
  is_marriage_related: boolean
  source?: string
  raw_input?: string
}

export type TxRow = {
  date: string
  description: string
  amount: number
  category: string
  who_for: string
}
