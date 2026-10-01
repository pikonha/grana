import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { mcp } from 'better-auth/plugins'
import { db } from '#/db/index'
import {
  authAccount, authSession, authUser, authVerification,
  oauthAccessToken, oauthApplication, oauthConsent,
} from '#/db/auth-schema'

const LOGIN_PAGE = '/login'
export const CONSENT_PAGE = '/oauth/consent'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: authUser, session: authSession, account: authAccount, verification: authVerification,
      oauthApplication, oauthAccessToken, oauthConsent,
    },
  }),
  emailAndPassword: { enabled: true },
  // Railway's x-forwarded-for is a 2-hop chain, which better-auth rejects without a
  // trustedProxies CIDR list. x-real-ip is a single value the edge overwrites, so it
  // can't be spoofed. Without this every request shares one rate-limit bucket.
  advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
  hooks: {
    // Client registration is open (MCP spec requires dynamic registration), so consent
    // is the only thing standing between a hostile client and a full read/write token.
    // better-auth's mcp plugin only renders the consent page when the *client* asks for
    // `prompt=consent`, which means any client can opt out of it. Force it server-side.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/mcp/authorize') return
      return { context: { query: { ...ctx.query, prompt: 'consent' } } }
    }),
  },
  plugins: [mcp({ loginPage: LOGIN_PAGE, oidcConfig: { loginPage: LOGIN_PAGE, consentPage: CONSENT_PAGE } })],
})
