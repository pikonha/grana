import { describe, expect, it } from 'vitest'
import { auth } from './auth-config'

/**
 * The MCP OAuth flow hands out full read/write tokens, and better-auth's mcp plugin
 * only renders the consent page when the *client* sends `prompt=consent`. If this
 * rewrite ever stops firing, any registered client can mint a token silently.
 */
describe('forced MCP consent', () => {
  const hook = auth.options.hooks?.before

  const run = (path: string, query: Record<string, string>) =>
    hook!({ path, query } as never) as Promise<{ context?: { query?: Record<string, string> } } | undefined>

  it('overrides a client-chosen prompt on /mcp/authorize', async () => {
    const result = await run('/mcp/authorize', { client_id: 'c', prompt: 'none' })
    expect(result?.context?.query).toEqual({ client_id: 'c', prompt: 'consent' })
  })

  it('leaves other endpoints alone', async () => {
    const result = await run('/sign-in/email', { prompt: 'none' })
    expect(result?.context?.query).toBeUndefined()
  })
})
