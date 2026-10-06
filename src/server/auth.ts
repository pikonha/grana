import { timingSafeEqual } from 'node:crypto'

function safeEqual(token: string, expected: string): boolean {
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Constant-time bearer check against an env secret. Never logs the secret. */
export function checkBearer(request: Request, envVar: string): boolean {
  const expected = process.env[envVar]
  if (!expected) return false // misconfigured server rejects rather than allows
  const header = request.headers.get('authorization') ?? ''
  return safeEqual(header.startsWith('Bearer ') ? header.slice(7) : '', expected)
}

/** Constant-time check of a custom header against an env secret (webhooks that cannot send a bearer). */
export function checkHeaderSecret(request: Request, header: string, envVar: string): boolean {
  const expected = process.env[envVar]
  if (!expected) return false
  return safeEqual(request.headers.get(header) ?? '', expected)
}
