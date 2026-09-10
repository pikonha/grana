# Finances

Multi-user personal finance app built with TanStack Start, Better Auth, Drizzle/Postgres, TanStack Query, and shadcn/ui.

## Local setup

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

`pnpm db:seed` replaces only the local demo user and is safe to rerun. It refuses remote database hosts. Demo login: `a@b.com` / `1234`.

With Docker Compose, no local env file is needed:

```bash
docker compose up -d
docker compose exec app pnpm db:push
docker compose exec app pnpm db:seed
```

Required environment variables:

```dotenv
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=http://localhost:3000
HERMES_WEBHOOK_SECRET=...
HERMES_USER_ID=better-auth-user-id-owned-by-hermes-writes
CRON_SECRET=...
```

`HERMES_USER_ID` is the Better Auth user ID assigned to external transaction writes. The webhook contract uses `account_id` and optional `tag_ids`; legacy `category_id` is still accepted as one tag. `card_id` is no longer accepted.

## Commands

- `pnpm dev` — local app
- `pnpm test` — unit tests
- `pnpm build` — production build
- `pnpm db:generate` — generate migration
- `pnpm db:push` — synchronize a development database
- `pnpm db:migrate` — apply generated migrations
- `pnpm db:seed` — reset deterministic demo data in a local database
- `pnpm start` — run `.output/server/index.mjs`

## PWA

Production builds are installable on desktop, Android, and iOS. The service worker
caches only versioned UI assets. Authenticated pages, API responses, and financial
data are always network-only; offline navigation shows a privacy-safe fallback.
Service-worker registration is intentionally disabled in development.

## MCP

`/api/mcp` exposes the app over the Model Context Protocol (streamable HTTP), OAuth-protected via Better Auth's `mcp` plugin — discovery at `/.well-known/oauth-authorization-server`. Every tool call resolves `userId` from the OAuth session and is scoped to that user's own data, same as the web UI.

Tools: `list_accounts`, `create_account`, `update_account`, `list_tags`, `create_tag`, `list_transactions`, `create_transaction`, `update_transaction`, `create_transfer`, `list_installment_plans`, `list_recurrence_rules`, `list_faturas`, `mark_fatura_paid`, `unmark_fatura_paid`. No delete tools are exposed over MCP.

## Railway

Set all six environment variables above; use the public app URL for `BETTER_AUTH_URL`. Apply the migration before deploying. The database migration is destructive versus the old single-user/card schema.

The daily cron remains:

```text
0 0 * * *
sh -c "curl -fsS -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"$APP_URL/api/cron/materialize-recurrence\""
```

The cron materializes rules for every user and remains idempotent. Installments are allowed only for expense transactions on an owned credit-card account. Tags are colored rows attached through `transaction_tag`, so one transaction can carry multiple labels.
