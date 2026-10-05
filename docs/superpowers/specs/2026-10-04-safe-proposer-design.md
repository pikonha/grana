# Hermes como proposer da Safe — design

Status: implementado fora do grana, na skill `safe` do vault pikos (`.claude/skills/safe/`). **Nenhuma mudança no grana.**

## Objetivo

O Hermes propõe na Safe (Base, `0x911b…d910`, 1.4.1, 2 de 3) as transferências USDC que precisam sair: top-up do ether.fi, pagamento das faturas e o repasse da mãe. Eu só reviso e assino no Safe{Wallet}.

## Decisões

- **O grana não sabe da Safe.** Sem campo novo, sem tool MCP nova. Destinos, valor do top-up e a chave moram no Hermes (`safe.json` no vault, `SAFE_PROPOSER_PK` e `SAFE_API_KEY` em `~/.hermes/.env` da VPS). O grana só fornece os valores pelas tools que já existem (`list_accounts`, `list_faturas`, `list_recurrence_rules`, `list_transactions`).
- **O proposer só propõe.** Assina o `safeTxHash` (EIP-712, v=27/28) e manda pro Transaction Service. Não é owner, não executa, não precisa de ETH.
- **BRL → USDC pela PTAX venda** do último boletim até hoje (mesma URL do `fetchPtax`), centavo de dólar arredondado pra cima.
- **Fatura vai pra conta nu.** O envio físico é pro depósito USDC da Binance (off-ramp), mas no grana é `transfer` Safe → `nu`. O Hermes faz essa troca depois que a tx executa e o sync importa o `expend`: cria a transfer e apaga o expend. É isso que substitui a mudança no chain sync.
- **ether.fi leva o resto do salário**: salário em USDC × 0,9 (10% fica na Safe) − repasses − faturas que vencem no mês − gastos da conta nu no mês (lançados + recorrências que ainda caem), que também vão pro off-ramp. Não é saldo-alvo: o saldo do ether.fi no grana começa no `sync_since` sem saldo inicial (hoje dá −R$ 3.556) e on-chain a safe do cartão tem 0 (o dinheiro fica no Lend).
- **Diário, não mensal.** O cron roda todo dia: lote (top-up, repasses, conta nu) no dia 4, depois que os cartões fecham; fatura que vence no mês e ainda não fechou já é descontada do resto do ether.fi pelo total do dia, e sai sozinha quando fechar; cada fatura entre o fechamento e o vencimento (o `closed` do grana também cobre ciclo futuro com parcela, então o script exige que o ciclo já tenha fechado; fatura vencida não sai, porque pode ter sido paga sem marcar). Idempotência pelas chaves no `origin` da proposta.

## O que ficou de fora

- Recorrência da mãe materializa um `expend` no grana; se a conta da regra for a Safe e a execução cair a mais de ±2 dias / ±3% dele, o sync cria outro. Não tratado.
- Marcar a fatura paga no grana continua manual: o pagamento sai da nu, depois do off-ramp.
- Safe Guard com allowlist de destinos: opcional, depois.

Detalhes de operação: `.claude/skills/safe/SKILL.md` no pikos.
