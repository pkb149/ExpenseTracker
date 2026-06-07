export const ALLOWED_EMAILS = new Set([
  'prashantkumarbharadwaj@gmail.com',
  'prayashikumari2@gmail.com',
])

export function b64url(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

export async function createSession(secret: string, email: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(
    JSON.stringify({ email, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  ))
  return `${payload}.${await hmacSign(secret, payload)}`
}

export async function verifySession(secret: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (sig !== await hmacSign(secret, payload)) return null
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    )
    const data = JSON.parse(json) as { email: string; exp: number }
    if (data.exp < Date.now() || !ALLOWED_EMAILS.has(data.email)) return null
    return data.email
  } catch { return null }
}

export function getCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.split(';').find(s => s.trim().startsWith(name + '='))
  return match ? match.split('=').slice(1).join('=').trim() : null
}
