<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/db#db-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core"
    for: "TanStack DB core concepts: createCollection with queryCollectionOptions, electricCollectionOptions, powerSyncCollectionOptions, rxdbCollectionOptions, trailbaseCollectionOptions, localOnlyCollectionOptions. Live queries via query builder (from, where, join, select, groupBy, orderBy, limit). Optimistic mutations with draft proxy (collection.insert, collection.update, collection.delete). createOptimisticAction, createTransaction, createPacedMutations. Entry point for all TanStack DB skills."
  - id: "@tanstack/db#db-core/collection-setup"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/collection-setup"
    for: "Creating typed collections with createCollection. Adapter selection: queryCollectionOptions (REST/TanStack Query), electricCollectionOptions (ElectricSQL real-time sync), powerSyncCollectionOptions (PowerSync SQLite), rxdbCollectionOptions (RxDB), trailbaseCollectionOptions (TrailBase), localOnlyCollectionOptions, localStorageCollectionOptions. CollectionConfig options: getKey, schema, sync, gcTime, autoIndex (default off), defaultIndexType, syncMode (eager/on-demand, plus progressive for Electric). StandardSchema validation with Zod/Valibot/ArkType. Collection lifecycle (idle/loading/ready/error). Adapter-specific sync patterns including Electric txid tracking, Query direct writes, and PowerSync query-driven sync with onLoad/onLoadSubset hooks."
  - id: "@tanstack/db#db-core/custom-adapter"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/custom-adapter"
    for: "Building custom collection adapters for new backends. SyncConfig interface: sync function receiving begin, write, commit, markReady, truncate, metadata primitives. ChangeMessage format (insert, update, delete). loadSubset for on-demand sync. LoadSubsetOptions (where, orderBy, limit, cursor). Expression parsing: parseWhereExpression, parseOrderByExpression, extractSimpleComparisons, parseLoadSubsetOptions. Collection options creator pattern. rowUpdateMode (partial vs full). Subscription lifecycle and cleanup functions. Persisted sync metadata API (metadata.row and metadata.collection) for storing per-row and per-collection adapter state."
  - id: "@tanstack/db#db-core/live-queries"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/live-queries"
    for: "Query builder fluent API: from, where, join, leftJoin, rightJoin, innerJoin, fullJoin, select, fn.select, groupBy, having, orderBy, limit, offset, distinct, findOne. Operators: eq, gt, gte, lt, lte, like, ilike, inArray, isNull, isUndefined, and, or, not. Aggregates: count, sum, avg, min, max. String functions: upper, lower, length, concat. Utility: coalesce, caseWhen. Math: add. $selected namespace. createLiveQueryCollection. Derived collections. Predicate push-down. Incremental view maintenance via differential dataflow (d2ts). Virtual properties ($synced, $origin, $key, $collectionId). Includes subqueries for hierarchical data. toArray and concat(toArray(...)) scalar includes. queryOnce for one-shot queries. createEffect for reactive side effects (onEnter, onUpdate, onExit, onBatch)."
  - id: "@tanstack/db#db-core/mutations-optimistic"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/mutations-optimistic"
    for: "collection.insert, collection.update (Immer-style draft proxy), collection.delete. createOptimisticAction (onMutate + mutationFn). createPacedMutations with debounceStrategy, throttleStrategy, queueStrategy. createTransaction, getActiveTransaction, ambient transaction context. Transaction lifecycle (pending/persisting/completed/failed). Mutation merging. onInsert/onUpdate/onDelete handlers. PendingMutation type. Transaction.isPersisted."
  - id: "@tanstack/db#db-core/persistence"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/persistence"
    for: "SQLite-backed persistence for TanStack DB collections. persistedCollectionOptions wraps any adapter (Electric, Query, PowerSync, or local-only) with durable local storage. Platform adapters: browser (WA-SQLite OPFS), React Native (op-sqlite), Expo (expo-sqlite), Electron (IPC), Node (better-sqlite3), Capacitor, Tauri, Cloudflare Durable Objects. Multi-tab/multi-process coordination via BrowserCollectionCoordinator / ElectronCollectionCoordinator / SingleProcessCoordinator. schemaVersion for migration resets. Local-only mode for offline-first without a server."
  - id: "@tanstack/db#meta-framework"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/db#meta-framework"
    for: "Integrating TanStack DB with meta-frameworks (TanStack Start, Next.js, Remix, Nuxt, SvelteKit). Client-side only: SSR is NOT supported — routes must disable SSR. Preloading collections in route loaders with collection.preload(). Pattern: ssr: false + await collection.preload() in loader. Multiple collection preloading with Promise.all. Framework-specific loader APIs."
  - id: "@tanstack/devtools#devtools-app-setup"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-app-setup"
    for: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  - id: "@tanstack/devtools#devtools-marketplace"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-marketplace"
    for: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  - id: "@tanstack/devtools#devtools-plugin-panel"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-plugin-panel"
    for: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  - id: "@tanstack/devtools#devtools-production"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-production"
    for: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  - id: "@tanstack/devtools-event-client#devtools-bidirectional"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-bidirectional"
    for: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  - id: "@tanstack/devtools-event-client#devtools-event-client"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-event-client"
    for: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  - id: "@tanstack/devtools-event-client#devtools-instrumentation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-instrumentation"
    for: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  - id: "@tanstack/devtools-vite#devtools-vite-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-vite#devtools-vite-plugin"
    for: "Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only."
  - id: "@tanstack/react-db#react-db"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-db#react-db"
    for: "React bindings for TanStack DB. useLiveQuery hook with dependency arrays (8 overloads: query function, config object, pre-created collection, disabled state via returning undefined/null). useLiveSuspenseQuery for React Suspense with Error Boundaries (data always defined). useLiveInfiniteQuery for cursor-based pagination (pageSize, fetchNextPage, hasNextPage, isFetchingNextPage). usePacedMutations for debounced React state updates. Return shape: data, state, collection, status, isLoading, isReady, isError. Import from @tanstack/react-db (re-exports all of @tanstack/db)."
  - id: "@tanstack/react-start#lifecycle/migrate-from-nextjs"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#lifecycle/migrate-from-nextjs"
    for: "Step-by-step migration from Next.js App Router to TanStack Start: route definition conversion, API mapping, server function conversion from Server Actions, middleware conversion, data fetching pattern changes."
  - id: "@tanstack/react-start#react-start"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#react-start"
    for: "React bindings for TanStack Start: createStart, StartClient, StartServer, React-specific imports, re-exports from @tanstack/react-router, full project setup with React, useServerFn hook."
  - id: "@tanstack/react-start#react-start/server-components"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#react-start/server-components"
    for: "Implement, review, debug, and refactor TanStack Start React Server Components in React 19 apps. Use when tasks mention @tanstack/react-start/rsc, renderServerComponent, createCompositeComponent, CompositeComponent, renderToReadableStream, createFromReadableStream, createFromFetch, Composite Components, React Flight streams, loader or query owned RSC caching, router.invalidate, structuralSharing: false, selective SSR, stale names like renderRsc or .validator, or migration from Next App Router RSC patterns. Do not use for generic SSR or non-TanStack RSC frameworks except brief comparison."
  - id: "@tanstack/router-core#router-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core"
    for: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
  - id: "@tanstack/router-core#router-core/auth-and-guards"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/auth-and-guards"
    for: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
  - id: "@tanstack/router-core#router-core/code-splitting"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/code-splitting"
    for: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
  - id: "@tanstack/router-core#router-core/data-loading"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/data-loading"
    for: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
  - id: "@tanstack/router-core#router-core/navigation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/navigation"
    for: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
  - id: "@tanstack/router-core#router-core/not-found-and-errors"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/not-found-and-errors"
    for: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
  - id: "@tanstack/router-core#router-core/path-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/path-params"
    for: "Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
  - id: "@tanstack/router-core#router-core/search-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/search-params"
    for: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
  - id: "@tanstack/router-core#router-core/ssr"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/ssr"
    for: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
  - id: "@tanstack/router-core#router-core/type-safety"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/type-safety"
    for: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
  - id: "@tanstack/router-plugin#router-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-plugin#router-plugin"
    for: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
  - id: "@tanstack/start-client-core#start-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core"
    for: "Core overview for TanStack Start: tanstackStart() Vite plugin, getRouter() factory, root route document shell (HeadContent, Scripts, Outlet), client/server entry points, routeTree.gen.ts, tsconfig configuration. Entry point for all Start skills."
  - id: "@tanstack/start-client-core#start-core/auth-server-primitives"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/auth-server-primitives"
    for: "Server-side authentication primitives for TanStack Start: session cookies (HttpOnly, Secure, SameSite, __Host- prefix), session read/issue/destroy via createServerFn and middleware, OAuth authorization-code flow with state and PKCE, password-reset enumeration defense, CSRF for non-GET RPCs, rate limiting auth endpoints, session rotation on privilege change. Pairs with router-core/auth-and-guards for the routing side."
  - id: "@tanstack/start-client-core#start-core/deployment"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/deployment"
    for: "Deploy to Cloudflare Workers, Netlify, Vercel, Node.js/Docker, Bun, Railway. Selective SSR (ssr option per route), SPA mode, static prerendering, ISR with Cache-Control headers, SEO and head management."
  - id: "@tanstack/start-client-core#start-core/execution-model"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/execution-model"
    for: "Isomorphic-by-default principle, environment boundary functions (createServerFn, createServerOnlyFn, createClientOnlyFn, createIsomorphicFn), ClientOnly component, useHydrated hook, import protection, dead code elimination, environment variable safety (VITE_ prefix, process.env)."
  - id: "@tanstack/start-client-core#start-core/middleware"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/middleware"
    for: "createMiddleware, request middleware (.server only), server function middleware (.client + .server), context passing via next({ context }), sendContext for client-server transfer, global middleware via createStart in src/start.ts, middleware factories, method order enforcement, fetch override precedence."
  - id: "@tanstack/start-client-core#start-core/server-functions"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/server-functions"
    for: "createServerFn (GET/POST), validator (Zod or function), useServerFn hook, server context utilities (getRequest, getRequestHeader, setResponseHeader, setResponseStatus), error handling (throw errors, redirect, notFound), streaming, FormData handling, file organization (.functions.ts, .server.ts)."
  - id: "@tanstack/start-client-core#start-core/server-routes"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/server-routes"
    for: "Server-side API endpoints using the server property on createFileRoute, HTTP method handlers (GET, POST, PUT, DELETE), createHandlers for per-handler middleware, handler context (request, params, context), request body parsing, response helpers, file naming for API routes."
  - id: "@tanstack/start-server-core#start-server-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-server-core#start-server-core"
    for: "Server-side runtime for TanStack Start: createStartHandler, request/response utilities (getRequest, setResponseHeader, setCookie, getCookie, useSession), three-phase request handling, AsyncLocalStorage context."
  - id: "@tanstack/virtual-file-routes#virtual-file-routes"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/virtual-file-routes#virtual-file-routes"
    for: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
  - id: "dotenv#dotenv"
    run: "pnpm dlx @tanstack/intent@latest load dotenv#dotenv"
    for: "Load environment variables from a .env file into process.env for Node.js applications. Use when configuring apps with secrets, setting up local development environments, managing API keys and database uRLs, parsing .env file contents, or populating environment variables programmatically. Always use this skill when the user mentions .env, even for simple tasks like \"set up dotenv\" — the skill contains critical gotchas (encrypted keys, variable expansion, command substitution) that prevent common production issues."
  - id: "dotenv#dotenvx"
    run: "pnpm dlx @tanstack/intent@latest load dotenv#dotenvx"
    for: "Use dotenvx to run commands with environment variables, manage multiple .env files, expand variables, and encrypt env files for safe commits and CI/CD."
<!-- intent-skills:end -->

---

# Finances App — Project Notes

Multi-user personal finances app (Better Auth). External agent **hermes** POSTs transactions to a secured endpoint; full web UI for manual CRUD + balances; an MCP server exposes the same operations to authenticated AI clients. Built from `.omc/plans/finances-app.md`.

## Scaffold command (exact)
```
npx @tanstack/cli@latest create finances --framework React --package-manager pnpm \
  --deployment railway --add-ons drizzle,db,form,table,tanstack-query --intent --non-interactive
```
Note: the plan's `--agent` flag does not exist in the current CLI; `--intent` is the agent-config flag. Tailwind is always on (the `--tailwind` flag is deprecated/ignored).

## Stack
TanStack Start (React 19, file-based routing) · TanStack Query/Table/Form · Drizzle ORM + Postgres (pg) · Tailwind v4 · Vitest · Railway (nitro adapter). No lint toolchain selected.

## Money & correctness rules
- **Integer cents everywhere.** `src/lib/money.ts#assertMoney` is called at every trust-boundary write (webhook + every create handler). UI collects dollars and converts with `Math.round(dollars*100)`.
- **Balance = `SUM` of rows** signed by type (`earn` +, `expend` −). No query-time derivation. See `balanceOf`.

## Data model (`src/db/schema.ts`)
`account, tag (aka category), recurrence_rule, installment_plan, transaction, transaction_tag, recurrence_rule_tag, fatura_payment`, plus Better Auth's own tables. Every owned row carries a real `user_id` scoped to the authenticated Better Auth user (multi-user, enforced via `requireUser()`/session in every server fn, tool, and route) — there is no `default-user` constant. `transaction.installment_plan_id` → `onDelete: 'cascade'`. `UNIQUE(recurrence_rule_id, period_key)` for cron idempotency.

## Endpoints
- `POST /api/transactions` — hermes webhook + external writes. Bearer `HERMES_WEBHOOK_SECRET`, constant-time compare, checked **before** body parse (401). Zod-validated with `.strict()` (400, rejects unknown keys like `card_id`), `assertMoney`, returns `{id}` (201). **The UI does NOT call this route** — it uses same-origin server functions, so the secret never reaches the browser (deviation from plan, made for security). Shared insert logic lives in `createTransactionCore`.
- `GET/POST /api/mcp` — Model Context Protocol server (streamable HTTP), OAuth-protected via Better Auth's `mcp` plugin. 14 tools, scoped per-user, no deletes. See README's MCP section for the tool list.

## Installments
`createInstallmentPlan` generates N real `transaction` rows up front on a monthly schedule; last row absorbs the rounding remainder so `SUM(rows) === total` (asserted). Rows are **delete-only** (no edit) to preserve the invariant — to change a plan, delete and recreate.

## Recurrence `period_key` format
daily `YYYY-MM-DD` · weekly `YYYY-MM-DD` (Monday) · monthly `YYYY-MM` · yearly `YYYY`.

## Env vars
- `DATABASE_URL` — Postgres connection string (Railway provides).
- `BETTER_AUTH_SECRET` — Better Auth session/token signing secret (32+ random chars).
- `BETTER_AUTH_URL` — public base URL the app is served from (used for auth callbacks and MCP OAuth).
- `HERMES_WEBHOOK_SECRET` — bearer secret for the transactions webhook.
- `HERMES_USER_ID` — Better Auth user ID that owns writes made through the webhook.

## Commands
- `pnpm dev` · `pnpm build` · `pnpm start` (`node .output/server/index.mjs`)
- `pnpm exec vitest run` — unit tests (money/installments/recurrence). Uses standalone `vitest.config.ts` because the app `vite.config.ts` loads nitro/start plugins incompatible with vitest.
- `pnpm db:generate` / `pnpm db:migrate` (drizzle-kit). Migration `drizzle/0000_*.sql` is generated.

## Deploy (Railway)
Web service + Postgres. Run migrations against the provisioned DB (`pnpm db:migrate`) before/at first deploy. No cron service: `listTransactions` calls `materializeDueRules` on every read (idempotent, catches up missed days).

## Deploy status (live)
- Project `finances` (workspace "lucas picollo's Projects"), env `production`. App URL: https://api-production-0617.up.railway.app
- Services: `api` (web), `Postgres`. DB migration applied (5 tables). Secrets set on `api`.
- Verified live: SSR 200, webhook 401/400/201.


## Gotchas
- **nitro pin**: scaffold pinned `nitro-nightly@4.0.0-20251010` (incompatible with vite 8; ships the dev SSR renderer into the prod `node-server` bundle → every request 500s with `EADDRNOTAVAIL` self-fetch). Repinned to `nitro-nightly@3.0.1-20260619`. Always run `node .output/server/index.mjs` locally before deploying.
- `drizzle-kit migrate` hung on the interactive spinner vs the remote proxy; applied `drizzle/0000_*.sql` directly via `pg`. The migration journal is NOT marked applied — a future `drizzle-kit migrate` will try to recreate tables; use `db:push` or mark it applied.
- **Server-only code must not leak into the client bundle.** A `#/server/*` module that the client imports (for its server functions) must contain *only* `createServerFn` definitions — the bundler strips their handlers (and `#/db`/pg) from the client. A **plain exported function that touches `db`** in such a module drags pg + `Buffer` into the browser → `ReferenceError: Buffer is not defined` at runtime. Keep those plain helpers in `*.core.ts` modules imported only by API routes / server-fn handlers (see `transactions.core.ts`, `recurrence.core.ts`). Guard: `ls .output/public/assets/db-*.js` after build must be empty.
- vitest needs the standalone config (above).
- Monthly recurrence uses JS month math — Jan 31 +1mo overflows to Mar 3 (`ponytail:` note in `recurrence.ts`); add end-of-month clamping if it matters.


<claude-mem-context>
# Memory Context

# [santo-domingo] recent context, 2026-07-11 7:32pm GMT-3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 1 obs (197t read) | 8,806t work | 98% savings

### Jul 11, 2026
1772 6:49p 🔵 Financial Planning Project Initialized in Santo Domingo Workspace

Access 9k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
