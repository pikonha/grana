# Open Finance sync (Pluggy)

Bank accounts and cards stop missing transactions: hermes and manual entry stay the real-time path, Pluggy is a daily reconciliation net. Design and decisions: [`superpowers/specs/2026-10-02-open-finance-pluggy-design.md`](superpowers/specs/2026-10-02-open-finance-pluggy-design.md).

## Setup

1. Connect Nubank and XP in [Meu Pluggy](https://meu.pluggy.ai).
2. In the Pluggy Dashboard (same login), create an application (gives `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET`), open its **Demo** → *Conectar Conta* → **MeuPluggy**. Each bank in Meu Pluggy becomes one item; copy the ids from *Itens Conectados* (`GET /items` is not available to Meu Pluggy accounts). Official guide: <https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use>.
3. Set on the `api` service: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_IDS` (comma-separated), `PLUGGY_WEBHOOK_SECRET` (random string).
4. Register the webhook once. The Dashboard UI cannot set headers, so use the API:

```bash
API_KEY=$(curl -s https://api.pluggy.ai/auth -H 'content-type: application/json' \
  -d '{"clientId":"…","clientSecret":"…"}' | jq -r .apiKey)
curl -X POST https://api.pluggy.ai/webhooks -H "X-API-KEY: $API_KEY" -H 'content-type: application/json' \
  -d '{"event":"all","url":"https://grana.up.railway.app/api/pluggy/webhook","headers":{"x-webhook-secret":"<PLUGGY_WEBHOOK_SECRET>"}}'
```

5. On **Contas**, edit an account → *Sincronização automática* → *Fonte: Open Finance* → pick the Pluggy account and the start date.

Meu Pluggy items fire webhooks like any item; the page-open and button triggers cover a missed delivery.

## What a run does

- Reads `from = max(sync_since, today − 30 d)` to open-ended (future `PENDING` installments). No cursor: the window is re-read each time and `UNIQUE(user_id, external_id)` makes it idempotent.
- Transactions come from `GET /v2/transactions` (cursor); the page-based `GET /transactions` answers 410.
- Bank account: inflow → `earn`, outflow → `expend`; a card-payment outflow (category *Credit card payment* or description *Pagamento de fatura*, since Nubank and XP categorize it as *Transfers*) → `transfer` to the card (credit of the same amount within ±3 days, else the card of the same item, else a plain `expend`).
- Card: charge → `expend`; installments claim (or create) an installment plan; a payment credit marks the closest closed fatura paid (no transaction); other credits → `earn`.
- Rows whose Pluggy id was recreated are re-pointed instead of duplicated.
- Each account applies in one DB transaction; errors land in `last_sync_error`. A broken connection shows *Reconecte no Meu Pluggy*.

## Limits

Meu Pluggy refreshes about once a day and its items refuse `PATCH`, so nothing here makes data fresher. Partial fatura payments mark the fatura paid; refunds do not reduce the fatura total; rows Pluggy deletes for good stay in grana.
