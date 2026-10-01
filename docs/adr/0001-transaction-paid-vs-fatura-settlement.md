# ADR 0001: Transaction Paid Flag vs Fatura Settlement

**Status:** Accepted  
**Date:** 2026-08-11  
**Deciders:** Product, Engineering

## Context

The app tracks two distinct settlement mechanisms:
1. Individual transaction settlement (bank-account spend/income, cash transactions)
2. Credit-card bill settlement (a fatura aggregating all card purchases in a cycle)

We needed a way to mark individual transactions as paid/unpaid for cash-flow tracking and pending-balance reporting, without conflating it with the existing fatura payment system.

## Decision

1. **Add a `paid` column to the `transaction` table** (boolean NOT NULL default true).

2. **Seed rule**: `paid = date <= today` at insert time (server UTC for imports/server creates; client local date for UI creates). Existing prod rows inherit `paid = true` from the column default via migration.

3. **Eligibility**: Only non-transfer, non-credit-card transactions are "payment trackable." The predicate is:  
   `type !== 'transfer' AND (accountId === null OR account.kind === 'bank_account')`  
   All credit_card accounts (prepaid and non-prepaid) are excluded — card purchases settle collectively via fatura, not per-transaction thumb.

4. **UI**: Transactions page shows a ThumbsUp icon for trackable rows. Paid → filled/solid, unpaid → outline + muted. Unpaid rows render at 60% opacity. A "Pendente" subtotal (signed net of the month's trackable unpaid rows) appears in the CardHeader whenever such rows exist — gated on row count, not on the total, since an unpaid earn and expend can cancel to zero while entries are still pending.

5. **Totals gating**: Home page "Saldo total" and month tiles (Receitas/Despesas/Resultado do mês) filter to `paid = true` before summing. Card transactions still count on their purchase date (even if the encompassing fatura is unpaid) because:
   - Card transactions default `paid = true` and are never toggled.
   - **Accepted inconsistency**: A card purchase on 2026-01-15 counts toward Jan saldo even if the Feb fatura (closing that cycle) remains unpaid. The alternative — gating card transactions on fatura payment — would make saldo jump by the full fatura amount on tick, which is more confusing than the current behavior.

6. **Not gated**: Reports (`/report`, `ReportCharts.tsx`), prepaid account balances (`prepaidBalanceOf`), and fatura/availableLimit logic remain completely untouched. They see all transactions regardless of `paid`.

7. **Update path**: A new server function `setTransactionPaid(id, paid)` toggles the flag. The existing `updateTransaction` path explicitly `.omit({ paid: true })` so edits cannot write the flag — only the dedicated toggle can.

8. **Stored, not derived**: `paid` is a persisted column seeded at insert, not a computed value. This allows expressing "a past-dated bill that is still unpaid" by inserting with `paid: false` and `date < today`. A derived `date > today` check could not model that case.

## Consequences

### Positive
- Clear separation: per-transaction settlement vs per-fatura settlement.
- Cash-flow tracking: users can see pending obligations (unpaid trackable transactions) distinct from fatura balances.
- Minimal schema change: one column, one migration, existing rows backfilled via default.
- Future-proof: mechanism works for scheduled/future transactions (recurrence materializer, CSV imports with future dates).

### Negative
- **Saldo inconsistency for card purchases**: A card transaction counts in saldo on purchase date even if the fatura is unpaid. Accepted trade-off to avoid saldo volatility on fatura tick. Documented in CONTEXT.md.
- **Two settlement paths**: Engineers must distinguish transaction.paid (non-card) from faturaPayment (card). ADR and glossary clarify the boundary.

### Neutral
- Installment transactions inherit `paid = true` from column default and are never toggled (the encompassing fatura pays them collectively). No UI change for installment rows.
- Recurrence-materialized rows get `paid = true` by default (they only insert `date <= today`). No change needed in the materializer.

## Alternatives Considered

**A. Gate card transactions on fatura payment**  
Rejected: saldo would jump by the full fatura amount (e.g. R$ 3000) when marking a single fatura paid, making month-over-month trends unreadable.

**B. Derive paid from date > today**  
Rejected: cannot model "a past-dated unpaid bill" (e.g. forgot to pay rent on the 1st, recording it later with date=2026-08-01 and paid=false).

**C. Add paid to faturas, unify settlement**  
Rejected: card purchases and individual transactions have different aggregation semantics. One fatura pays many transactions; one non-card transaction is one settlement event.
