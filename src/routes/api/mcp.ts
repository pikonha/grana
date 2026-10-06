import { createFileRoute } from '@tanstack/react-router'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withMcpAuth } from 'better-auth/plugins'
import { auth } from '#/server/auth-config'
import { registerFinanceTools } from '#/server/mcp-tools'

/**
 * Multi-tenant MCP server: same-origin. Every tool resolves
 * `userId` from the OAuth access token session (via withMcpAuth), mirroring
 * the scoping requireUser() does for the UI's server functions.
 */
const handler = withMcpAuth(auth, async (request, session) => {
  const server = new McpServer({ name: 'finances', version: '1.0.0' })
  registerFinanceTools(server, session.userId)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
})

export const Route = createFileRoute('/api/mcp')({
  server: { handlers: { GET: ({ request }) => handler(request), POST: ({ request }) => handler(request) } },
})
