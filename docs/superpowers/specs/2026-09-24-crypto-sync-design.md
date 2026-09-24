# Crypto account auto-sync — design

Status: approved in chat 2026-09-24. Scope: sub-project 2 of "auto-update accounts" (crypto). Open Finance (TradFi) is a separate, later spec.

## Goal

Crypto accounts stop missing transactions. The user marks an account as crypto, enables auto-sync, and every on-chain movement since a chosen date lands as a normal `transaction` row in BRL cents, without duplicating what hermes or the user already entered.

## User's setup (the concrete target)

| Account | App model | Chain(s) | Activity |
|---|---|---|---|
| Safe | `bank_account` | Base | Salary arrives in USDC; holds savings; tops up ether.fi |
| ether.fi Cash | `credit_card` + `prepaid` (debit mode, never negative) | OP Mainnet (spend) + Base (deposit) | Daily card spending |

Top-ups go Safe (Base) → the ether.fi deposit address on Base; ether.fi bridges to OP.

## Decisions

- **Import transactions, not just balance.** Balance stays `SUM` of rows (`balanceOf` / `prepaidBalanceOf` unchanged).
- **Convert to BRL at import.** `amount` = integer BRL cents = USD × PTAX (BCB) of the tx date; weekends/holidays use the last business day's rate. The original USD cents are kept on the row (`usd_amount`). The account balance is therefore "historical BRL", not current USD balance × today's rate — accepted.
- **Stablecoins only** (USDC, USDT, allowlisted by contract address per chain; USD value = token amount, 6 decimals). Anything else is ignored in v1.
- **No new account kind.** An account is crypto when `wallet_address` is set.
- **Data source:** Etherscan V2 multichain API (one free key; `chainid` 8453 Base, 10 OP). Prices: BCB PTAX OData (no key).
- **Trigger:** lazily on read (same pattern as `materializeDueRules`), throttled to once per 15 min per account, plus a manual "Sincronizar" button. No cron.
- **Merchant names are not on-chain.** ether.fi spends import with note `ether.fi Cash`; the user (or a matched hermes row) supplies name/category. Scraping ether.fi's private API is out of scope.

## Data model (`src/db/schema.ts`)

`account` gains:

| column | type | notes |
|---|---|---|
| `wallet_address` | text null | lowercase `0x` + 40 hex; non-null ⇒ crypto account |
| `sync_kind` | enum `wallet` \| `etherfi_cash`, null | |
| `sync_enabled` | boolean not null default false | |
| `sync_since` | date null | backfill start |
| `sync_cursor` | jsonb null | `{ "<chainid>": lastProcessedBlock }` |
| `last_synced_at` | timestamp null | |
| `last_sync_error` | text null | cleared on success |

`transaction` gains:

| column | type | notes |
|---|---|---|
| `external_id` | text null, `UNIQUE` | `<chainid>:<txhash>:<logIndex>`; idempotency lock |
| `usd_amount` | integer null | original USD cents |

## Sources per `sync_kind`

**`wallet` (Safe, Base):** stablecoin ERC20 transfers of `wallet_address` (Etherscan `tokentx`).
- incoming → `earn`
- outgoing to the `wallet_address` of another synced account of the same user → one `transfer` (`account_id` = this, `counter_account_id` = that)
- other outgoing → `expend`

**`etherfi_cash` (ether.fi, OP + Base):**
- spends: `Spend(address indexed safe, bytes32 indexed txId, BinSponsor indexed binSponsor, address[] tokens, uint256[] amounts, uint256[] amountInUsd, uint256 totalUsdAmt, Mode mode)` logs from ether.fi `CashEventEmitter` on OP, filtered by `safe = wallet_address` → `expend` of `totalUsdAmt`. Date = block timestamp.
- outgoing ERC20 transfers from the ether.fi safe are ignored (they are the settlement leg of a `Spend`; counting both would double-spend).
- incoming stablecoin transfers (OP or Base) → skipped if they match an existing `transfer` into this account (same amount within 1% for bridge fees, ±1 day); otherwise `earn` (covers refunds and other sources).

**Verify before coding (plan task 1), using the user's real addresses:** the ether.fi deposit address on Base equals the OP safe address (if not, add `deposit_address`); the `CashEventEmitter` address on OP and `totalUsdAmt` decimals; the stablecoin contract addresses on Base and OP.

## Matching existing rows (hermes/manual)

Before inserting a synced `earn`/`expend`, look for a row with `external_id IS NULL`, same user, same `account_id`, same `type`, `date` within ±2 days, `amount` within ±3% of the converted value. Several candidates → closest by amount, then date. Match → set `external_id` and `usd_amount` on that row and keep its amount, note and tags. No match → insert.

## Flow

```
listTransactions → materializeDueRules → syncDueAccounts(userId) → select rows
syncDueAccounts: accounts where sync_enabled and (last_synced_at is null or < now − 15min)
  per account:
    fetch events from sync_cursor (or block at sync_since) per chain
    fetch PTAX for the distinct dates
    map + match (pure, src/lib/chain-sync.ts)
    db.transaction: insert/claim rows (onConflictDoNothing on external_id), advance sync_cursor, set last_synced_at, clear last_sync_error
```

- A synced row the user deletes is not re-created: the cursor has already moved past it.
- Concurrent reads are safe: `UNIQUE(external_id)` + `onConflictDoNothing`.

## Errors

- Any fetch failure (Etherscan, PTAX, rate limit, malformed response) aborts that account entirely: no partial rows, cursor unchanged, `last_sync_error` set, and the next read retries.
- `syncDueAccounts` never throws into `listTransactions`: it catches, logs and continues.
- Every converted amount goes through `assertMoney`.

## Code layout

- `src/lib/chain-sync.ts`: pure mapping + matching (no I/O), unit-tested.
- `src/server/chain-sync.core.ts`: Etherscan + PTAX fetch, db writes. Server-only; imported only from server-fn handlers (bundle rule in AGENTS.md).
- `src/server/accounts.ts`: new `syncAccountNow` server fn (the button).
- `src/server/schemas.ts`: `accountInput` gains the optional sync fields (address regex, `sync_kind` enum, `sync_since` isoDate).
- `src/routes/_authed/accounts.tsx`: "Sincronização cripto" section in the form (checkbox, address, kind, since, auto-sync toggle); account card shows "sincronizado há X min", the Sincronizar button and the last error.
- New env `ETHERSCAN_API_KEY` (`.env.example`, Railway, AGENTS.md env list).

Unchanged: hermes webhook, MCP tools, CSV import, reports.

## Testing

- `src/lib/chain-sync.test.ts` with Etherscan-shaped fixtures: incoming/outgoing/transfer mapping; `Spend` plus ignored settlement transfer; top-up dedupe on the ether.fi side; matching (±2d/±3%, closest wins, already-claimed rows skipped); PTAX weekend fallback; non-stablecoin ignored.
- Manual: run the sync locally against the user's real Safe and ether.fi addresses and compare the rows against the explorers.

## Rollout

`pnpm db:generate` → apply the migration to Railway Postgres (mind the unapplied-journal gotcha in AGENTS.md) → set `ETHERSCAN_API_KEY` → deploy → enable sync per account in the UI.

## Out of scope (v1)

ETH and other non-stable tokens · current market value on the account card · merchant names from the ether.fi API · Open Finance · cron.

## Implementation notes (2026-09-24)

What task 1 found, and where the build departs from the design above:

- **Data source: Blockscout, not Etherscan.** Etherscan V2's free tier answers "Free API access is not supported for this chain" for Base and OP. The build uses Blockscout's Etherscan-compatible API (`api.blockscout.com/v2/api?chain_id=…`, free PRO key, 5 req/s) with env `BLOCKSCOUT_API_KEY` in place of `ETHERSCAN_API_KEY`. Without a key it falls back to the keyless public explorers, which allow about 10 requests per window (dev only).
- **Transfers come from Blockscout's REST `token-transfers`, not `tokentx`.** `tokentx` has no `logIndex`, and `getLogs` filtered by topic on the USDC contract takes about 40 s on Base. The REST endpoint is indexed by address, returns `log_index`, and answers in about 1 s. There is one call per token per chain, paged from newest to oldest down to the cursor. `Spend` logs still come from `getLogs` on the emitter (0.3 s).
- **Verified contract facts:**
  - `CashEventEmitter` on OP is `0x380b2e96799405be6e3d965f4044099891881acb` (from `etherfi-protocol/cash-v3`, `deployments/mainnet/10`).
  - `Spend` topic0 is `0x244f4cc0…90fc`, checked against a live log.
  - `totalUsdAmt` is 6-decimal (`PriceProvider.DECIMALS`).
  - The safe address is the same on every chain (Create3), so no `deposit_address` is needed.
  - The stablecoins are USDC and USDT, on Base and on OP.
- **The ether.fi Base leg is not fetched.** ether.fi bridges every Base deposit to the OP safe, and the funds arrive from `TopUpDest`. Counting the Base leg as well would record a single external deposit twice, so for the ether.fi account sync reads only OP.
- **Ether.fi outgoing transfers:** only the settlement leg of a `Spend` (same tx hash) is ignored. Any other outgoing transfer, such as a withdrawal, becomes an `expend`, or a `transfer` when it goes to a sibling. Ignoring every outgoing transfer would inflate the balance.
- **Transfers between the user's own accounts:** an incoming transfer from a sibling that syncs the same chain is skipped, because the sibling records it as its outgoing `transfer`. The top-up dedupe applies to every kind, and each recorded transfer absorbs one arrival only.
- **Wallets first:** any run that includes an ether.fi card first syncs the user's auto-synced wallets, whatever their throttle. If a wallet fails, the card is skipped (its error is stored), so a top-up cannot turn into an `earn`.
- **Re-reads are idempotent:** events whose `external_id` already exists are dropped before matching. A re-read therefore never claims a second row.
- **Margin behind the head:** `sync_cursor` stops 150 blocks (~5 min) behind the head, to give the indexer time to catch up.
- **PTAX fallback also covers today:** a transaction made before the ~13h bulletin gets the previous day's rate, and keeps it.
- **ether.fi Lend (`LendGateway`, OP) is internal.** Deposits to and withdrawals from Lend are ignored both ways, so lent money still counts as card balance. Yield is not imported.
- **Live run (2026-09-24):** tested against a public ether.fi safe on OP from 2026-09-20. 12 rows (spends, cashback, top-ups), cursor saved, about 5 s. That run exposed the Lend in/out pairs, which led to the rule above.
- **Live run with a PRO key (2026-09-24):**
  - ether.fi safe on OP: 12 rows, about 6 s.
  - Quiet Base wallet: 20 rows, about 20 s. The slow part is Blockscout scanning USDT transfers for an address that has none (about 10 s). Timeout raised to 30 s.
  - Running the sync a second time adds no rows on either account.
- **Refund and cashback labels:** incoming from ether.fi's `refundWallet` or `CashbackDispatcher` gets the note "ether.fi Cash (reembolso)" or "ether.fi Cash (cashback)".
- **Page cap:** at most 40 pages (about 2000 transfers per token) per run. A bot-busy address fails with an error instead of hanging.
- **MCP:** the MCP tools' code is unchanged, but `create_account`/`update_account` take `accountInput`, so they accept the new optional sync fields.
- **Throttle, lock and retry:** before syncing, `last_synced_at` is claimed atomically. After a failure, the retry therefore waits for the next 15-min slot instead of firing on every 2 s poll. The button retries right away.
- **`listTransactions` does not await the sync.** Synced rows appear on the next poll.
- **Unique key:** `UNIQUE(user_id, external_id)`, so two users can track the same address.
- **Changing a crypto config restarts the backfill.** Editing the address, kind or since date resets `sync_cursor`.
- **Keeping the config on partial updates:** when `walletAddress` is omitted (for example, an MCP `update_account` rename), the sync config is kept. `null` turns sync off.
