# Open Finance (Pluggy) account sync — design

Status: approved in chat 2026-10-02. Scope: sub-project 3 of "auto-update accounts" (TradFi), the follow-up the crypto spec deferred.

## Goal

Traditional bank accounts and cards stop missing transactions. hermes and manual entry stay the real-time path; Pluggy is the reconciliation net: once a day it claims what was already entered and inserts what was missed, without duplicates.

## User's setup (the concrete target)

| grana account | App model | Institution |
|---|---|---|
| `nu` | `bank_account` | Nubank |
| `nu card` | `credit_card`, closes day 1, due day 8 | Nubank |
| `xp card` | `credit_card`, closes day 3, due day 8 | XP |

Single user. No other grana user will connect Open Finance.

## Data source: Meu Pluggy

- Open Finance Brasil only serves regulated participants; an individual reaches it through an aggregator.
- **Meu Pluggy** (meu.pluggy.ai) gives free API access to the holder's own data, indefinitely, for personal use: up to 5 connections, own accounts only, not to be served to third parties. The Dashboard's 15-day trial banner does not apply to this use.
- The user connects Nubank and XP in Meu Pluggy, then authorizes the `MeuPluggy` connector once per bank in the Pluggy Dashboard app. Each authorization yields an **Item ID**.
- **Freshness ceiling: ~1 day.** Meu Pluggy refreshes its items once a day on its own schedule. The items the app sees are proxies: `PATCH /items/{id}` returns `400 "MeuPluggy item cant be updated"`. Forcing refresh or connecting Open Finance directly needs the paid Dados plan (from R$ 2,500/month), which is out of scope.
- Nothing grana does makes data fresher than Meu Pluggy's refresh. Triggers below only remove extra delay after it.

## Configuration

Env vars (single user, same pattern as `HERMES_USER_ID`):

- `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` — Dashboard application credentials.
- `PLUGGY_ITEM_IDS` — comma-separated Item IDs (one per bank). The API has no "list my items" call.
- `PLUGGY_WEBHOOK_SECRET` — value of the custom header Pluggy sends on webhooks.

Missing client id/secret/items → Pluggy sync is disabled: the account form hides the Open Finance section and the webhook returns 503.

## Data model

- `sync_kind` enum gains `'pluggy'`.
- `account.pluggy_account_id text` (Pluggy account UUID). An account is Pluggy-synced when this is set and `sync_kind = 'pluggy'`.
- Reused as-is: `sync_enabled`, `sync_since`, `last_synced_at`, `last_sync_error`. `sync_cursor` is unused for Pluggy.
- `transaction.external_id = 'pluggy:<pluggy transaction id>'`, protected by the existing `UNIQUE(user_id, external_id)`.
- Amounts are BRL; converted to integer cents and passed through `assertMoney`. `usd_amount` stays null.

## Triggers

1. **Webhook `POST /api/pluggy/webhook`.**
   - Checks `PLUGGY_WEBHOOK_SECRET` header with a constant-time compare, before body parse (401 otherwise). Pluggy has no signature; the custom header is the only protection.
   - The payload is a trigger only. grana re-fetches from the Pluggy API with its own credentials, so a forged payload can at most cause a sync.
   - Events: `item/updated` and `transactions/created|updated|deleted` → sync every enabled account linked to that `itemId`. `item/error` → write `last_sync_error` on those accounts.
   - Responds 202 immediately; the sync runs in the background (Pluggy times out at 10 s, retries at ~15 min and ~2 h).
   - Bypasses the 30-min throttle (it signals new data) but respects the in-process `syncing` Set.
   - Registration: once, via `curl POST https://api.pluggy.ai/webhooks` with `{ event: 'all', url, headers }`, because the Dashboard UI cannot set headers. Documented in `docs/open-finance.md`.
   - Unknown: whether Meu Pluggy proxy items fire webhooks at all. The fallback below makes that irrelevant for correctness.
2. **Page-open fallback.** `syncDueAccounts` (already called by `listAccounts`) claims Pluggy accounts with the same atomic 30-min claim on `last_synced_at` as crypto.
3. **"Sincronizar" button.** `syncAccountNow`, unchanged.

## Fetch

- `POST /auth` exchanges client id/secret for an `apiKey` valid 2 h; cached in memory until expiry.
- `GET /accounts?itemId=` per configured item, for the account-form select (name, type, number).
- `GET /transactions?accountId=&from=&to=` paginated until the last page.
- Window: `from = max(sync_since, today − 30 d)`, `to` open-ended (future `PENDING` installments). No cursor: every run re-reads the window and idempotency comes from `external_id`. The 30-day window absorbs late arrivals and recreated ids.
- Item status `LOGIN_ERROR` / `OUTDATED` / expired consent → `last_sync_error = 'Reconecte no Meu Pluggy'`, no writes.

## Mapping

Pure, in `src/lib/pluggy-sync.ts`. Input: Pluggy transactions for one account, the account and its sibling Pluggy accounts, existing rows in the window, installment plans of the account, faturas. Output: a plan of inserts, claims, external-id re-points, installment plans to create and fatura payments to insert.

### Bank account (`+` inflow, `−` outflow)

| Pluggy | grana |
|---|---|
| inflow | `earn` |
| ordinary outflow | `expend` |
| outflow with Pluggy category *Credit card payment* | `transfer` from this account to a card. Counter account: the linked card that received a credit of the same amount within ±3 days; else the linked card of the same item; else no card in grana → `expend` (its purchases are not tracked, so the payment is a real expense) |

### Credit card (`+` charge, `−` credit)

| Pluggy | grana |
|---|---|
| charge, no installments | `expend` |
| charge with `creditCardMetadata.totalInstallments > 1` | Look for a plan on this account with the same count and a start date within ±3 days of the derived start. Found → claim row `installmentNumber`. Not found → create the plan with `createInstallmentPlan` (start = this row's date − (k − 1) months, total = `totalAmount` or amount × N) and claim row k |
| credit categorized as payment ("pagamento recebido") | No transaction. Insert `fatura_payment` for the closed cycle whose vencimento is closest to the payment date. `UNIQUE(account_id, cycle_key)` makes it idempotent |
| other credit (refund) | `earn` on the card |

### Matching hermes / manual rows

Before inserting, each mapped row looks for an existing row that:
- has `external_id IS NULL`;
- is on the same account and in the same direction: an outflow matches an `expend` or a `transfer` out of the account; an inflow matches an `earn` or a `transfer` into it;
- has exactly the same amount;
- is dated within ±2 days.

Closest date wins. A claimed row gets `external_id` and keeps its amount, note, tags and time. Installment rows are matched through their plan (above), not this rule.

### Recreated Pluggy ids

Pluggy may delete a transaction and create a new id when date, description or amount change a lot (e.g. `PENDING` → `POSTED`). Rows with `external_id` `pluggy:*` inside the window whose id is no longer returned join the matching pool. A match re-points `external_id` instead of inserting.

### Inserted rows

- `note` = Pluggy description.
- `time` = timestamp converted to America/Sao_Paulo when the timestamp carries a time; null otherwise.
- All statuses are imported (`PENDING` and `POSTED`).
- `paid` follows the existing insert seed rule.

### Accepted simplifications (marked `ponytail:` in code)

- A partial fatura payment marks the fatura paid.
- A refund lands as `earn` and does not reduce the fatura total, which sums `expend` only. Changing fatura math is a later decision.
- A transaction Pluggy deletes for good stays in grana; nothing is auto-deleted because the user may have edited the row.
- A plan first seen at installment k > 1 creates installments 1..k−1 too, even before `sync_since`.
- A webhook arriving while that account is mid-sync is dropped; the next trigger catches up through the window.

## Writes and errors

- Each account's plan is applied in one DB transaction; on error nothing is written and `last_sync_error` is set (shown on the Contas page, like crypto).
- 429 / network errors are recorded; the next trigger retries.
- Concurrency: the in-process `syncing` Set from crypto sync guards per account.

## Code layout

| File | Role |
|---|---|
| `src/lib/pluggy-sync.ts` | Pure mapping, installment resolution, fatura-cycle choice, matching, re-pointing |
| `src/lib/pluggy-sync.test.ts` | Unit tests |
| `src/server/pluggy-sync.core.ts` | Auth cache, fetch, apply plan, error recording. Imported only by server-fn handlers and the API route |
| `src/routes/api/pluggy/webhook.ts` | Webhook route |
| `src/server/chain-sync.core.ts` | `syncDueAccounts` / `syncAccountNowCore` dispatch by `sync_kind` to Pluggy sync |
| `src/db/schema.ts` + `drizzle/NNNN_*.sql` | Enum value, `pluggy_account_id` column |
| account form | "Open Finance" section: Pluggy account select, `sync_since`, toggle; reuses the crypto spinner and "Sincronizar" |
| `docs/open-finance.md` | Setup: Meu Pluggy, Dashboard app, env vars, webhook `curl` |
| `CLAUDE.md` | New env vars |

Out of scope: MCP tools for Pluggy config, multi-user Pluggy credentials, paid Pluggy plans, investments.

## Testing

- `src/lib/pluggy-sync.test.ts`: one case per mapping-table row, plus plan created vs claimed, fatura-cycle choice, matching against hermes rows (expend and transfer), recreated id re-point, idempotency (running the same input twice yields an empty plan).
- Webhook route: 401 without the header, 202 with it, 503 when Pluggy env is missing.
- Manual: connect Meu Pluggy, link the three accounts, press "Sincronizar", confirm no duplicates against hermes rows; use the Dashboard "Salvar e Testar" to confirm the webhook path.

## Sources

- Meu Pluggy terms and limits: https://www.pluggy.ai/meu-pluggy
- Pricing: https://www.pluggy.ai/precos
- Item lifecycle: https://docs.pluggy.ai/docs/item-lifecycle
- Transactions object: https://docs.pluggy.ai/docs/transactions
- Webhooks: https://docs.pluggy.ai/docs/webhooks
- MeuPluggy proxy items refuse PATCH: https://github.com/Jhony4lves/SFP/issues/268
