# Domain Glossary

**Transaction**  
A monetary event: earn (inbound), expend (outbound), or transfer (between accounts). Each transaction has an amount (integer cents), date, optional account, optional tags/category, and a `paid` flag indicating settlement status.

**Paid**  
Boolean flag on a transaction indicating whether it has been settled. Seeded as `true` for `date <= today` on insert, `false` for future-dated entries. Trackable only for non-card, non-transfer transactions (see Payment Trackable). Card purchases are never individually marked paid — they settle collectively through a Fatura Payment.

**Pending**  
A transaction that is payment-trackable and has `paid = false`. Pending totals sum signed amounts of such transactions within a period, shown in the transactions page header.

**Payment Trackable**  
Predicate: a transaction is trackable iff `type !== 'transfer'` AND (`accountId === null` OR the account's kind is `'bank_account'`). All credit_card accounts (prepaid and non-prepaid) are excluded. Only trackable transactions show the paid thumb UI.

**Fatura** (Invoice/Bill)  
Aggregated credit-card balance for a billing cycle (accountId + cycleKey). Composed of the `expend` transactions whose date falls in that cycle — there is no carry-forward of a previous unpaid balance; each cycle's total stands alone. A fatura is marked paid collectively via a Fatura Payment row, not by toggling individual transactions. Prepaid cards have no faturas.

**Fatura Payment**  
A row recording that a specific fatura (accountId + cycleKey) was settled on a given date. One payment settles the entire bill; individual card transactions within the fatura do not have toggleable paid status.

**Settlement**  
The act of marking an obligation fulfilled. For non-card transactions: toggling the `paid` flag. For card transactions: inserting a Fatura Payment row for the bill's cycle. The two mechanisms are separate and must not be conflated — a card purchase's `paid` flag (always true by default) does not mean the fatura is settled.

**Saldo Total** (Total Balance)  
Sum of `signedAmount(type, amount)` over all earn/expend transactions where `paid = true`. Excludes unpaid transactions. Card transactions count on their purchase date (even if the fatura is unpaid) because their `paid` flag defaults true and is not toggled — accepted inconsistency to avoid saldo jumping by a full fatura on tick.

**Account**  
Either `'credit_card'` or `'bank_account'`. Credit cards can be limit-based (closingDay, dueDay, monthly faturas) or prepaid (tracked balance). Bank accounts track cash/checking/savings. Account kind determines whether transactions are payment-trackable.

**Installment Plan**  
A multi-month credit-card purchase split into N equal (or near-equal) installments. Each installment is a separate transaction row linked by `installmentPlanId`. All inherit the default `paid = true` and are never individually toggled — the encompassing fatura payment settles them collectively.

**Recurrence Rule**  
Template for repeating transactions. Materialized daily by a cron job, inserting transaction rows for each due period. Materialized rows get `paid = true` by column default (the materializer does not specify paid, and the date is always <= today).
