import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { createAccount, listAccounts } from "#/server/accounts";
import { createCategory, deleteCategory, listCategories } from "#/server/categories";
import { listFaturas } from "#/server/faturas";
import {
  createTransaction,
  createTransfer,
  importTransactions,
  listTransactions,
} from "#/server/transactions";
import type {
  CreateTransactionInput,
  ImportTransactionsInput,
  TransferInput,
} from "#/server/schemas";
import type { Category } from "#/db/schema";
import type { TransactionRow } from "#/server/transactions";
import { countsInTotal, isOpeningBalance, prepaidBalanceOf, savingsRate, totalBalanceOf } from "#/lib/money";
import { appToday } from "#/lib/dates";
import {
  financeQueryKeys,
  newestTransactions,
  optimisticCategory,
  optimisticId,
  optimisticTransaction,
  optimisticTransfer,
} from "#/lib/optimistic";
import { StatTile } from "@/components/charts";
import { ImportCsvModal } from "@/components/ImportCsvModal";
import { TransactionModal } from "@/components/TransactionModal";
import { TransferModal } from "@/components/TransferModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EMPTY_SELECT_VALUE,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authed/")({ component: Dashboard });

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [showValues, setShowValues] = useState(true);
  // "" = todas as contas
  const [accountId, setAccountId] = useState("");
  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listTransactions(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories(),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
  });
  const { data: faturas = [] } = useQuery({
    queryKey: ["faturas"],
    queryFn: () => listFaturas(),
  });
  const inAccount = (transaction: TransactionRow) =>
    !accountId ||
    transaction.accountId === accountId ||
    transaction.counterAccountId === accountId;
  const statsTransactions = transactions.filter(
    (
      transaction
    ): transaction is typeof transaction & { type: "earn" | "expend" } =>
      transaction.type !== "transfer"
  );
  const today = appToday();
  const monthStats = statsTransactions.filter(
    (transaction) =>
      transaction.date.startsWith(today.slice(0, 7)) &&
      inAccount(transaction) &&
      !isOpeningBalance(transaction)
  );
  // Realized = paid and not in the future; the rest of the month (future
  // installments, unpaid bills) is the forecast shown under "Gasto no mês".
  const isRealized = (tx: { paid: boolean; date: string }) =>
    tx.paid && tx.date <= today;
  const monthTransactions = monthStats.filter(isRealized);
  const monthForecastExpend = monthStats
    .filter((tx) => tx.type === "expend" && !isRealized(tx))
    .reduce((total, tx) => total + tx.amount, 0);
  const paidTransactions = transactions.filter((tx) => tx.paid);
  const balance = accountId
    ? prepaidBalanceOf(accountId, transactions)
    : totalBalanceOf(accounts, transactions);
  // Same accounts as "Todas as contas", so the bars add up to the total.
  const accountBalances = accounts
    .filter(countsInTotal)
    .map((account) => ({
      name: account.name,
      balance: prepaidBalanceOf(account.id, paidTransactions),
    }))
    .filter((row) => row.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
  // Mini chart fits ~6 bars; the tail folds into "Outras" instead of cramming.
  const chartBalances =
    accountBalances.length > 6
      ? [
          ...accountBalances.slice(0, 5),
          {
            name: "Outras",
            balance: accountBalances
              .slice(5)
              .reduce((total, row) => total + row.balance, 0),
          },
        ]
      : accountBalances;
  const sumByType = (type: "earn" | "expend") =>
    monthTransactions
      .filter((transaction) => transaction.type === type)
      .reduce((total, transaction) => total + transaction.amount, 0);
  const monthEarn = sumByType("earn");
  const monthExpend = sumByType("expend");
  const monthRate = savingsRate(monthEarn, monthExpend);
  const currentFaturasTotal = faturas
    .filter(
      (fatura) =>
        fatura.isCurrent && (!accountId || fatura.accountId === accountId)
    )
    .reduce((total, fatura) => total + fatura.total, 0);
  const create = useMutation({
    mutationFn: (data: CreateTransactionInput) => createTransaction({ data }),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = queryClient.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      queryClient.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          newestTransactions([optimisticTransaction(data), ...current]),
      );
      return { previous };
    },
    onError: (_error, _data, context) =>
      queryClient.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
        queryClient.invalidateQueries({
          queryKey: financeQueryKeys.installmentPlans,
        }),
      ]),
  });
  const deleteCategoryMutation = useMutation({
    mutationFn: (data: { id: string; replacementId?: string | null }) =>
      deleteCategory({ data }),
    // Not returned: a returned promise makes mutateAsync wait for the refetches,
    // which delayed the "move to which tag?" dialog. The probe call deletes nothing.
    onSuccess: ({ deleted }) => {
      if (!deleted) return;
      for (const queryKey of [
        financeQueryKeys.categories,
        financeQueryKeys.transactions,
        financeQueryKeys.recurrenceRules,
      ])
        void queryClient.invalidateQueries({ queryKey });
    },
  });
  const removeCategory = (id: string, replacementId?: string | null) =>
    deleteCategoryMutation.mutateAsync({ id, replacementId });
  const createCategoryMutation = useMutation({
    mutationFn: (data: { name: string; color: string; kind: "earn" | "expend" }) => createCategory({ data }),
    onMutate: async ({ name, color, kind }) => {
      await queryClient.cancelQueries({ queryKey: financeQueryKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(
        financeQueryKeys.categories,
      );
      const temporaryId = optimisticId();
      queryClient.setQueryData<Category[]>(
        financeQueryKeys.categories,
        (current = []) =>
          [...current, optimisticCategory(name, temporaryId, color, kind)].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
      );
      return { previous, temporaryId };
    },
    onSuccess: ({ id }, _data, context) =>
      queryClient.setQueryData<Category[]>(
        financeQueryKeys.categories,
        (current = []) =>
          current.map((category) =>
            category.id === context?.temporaryId
              ? { ...category, id, userId: category.userId }
              : category,
          ),
      ),
    onError: (_error, _data, context) =>
      queryClient.setQueryData(financeQueryKeys.categories, context?.previous),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.categories }),
  });
  const transfer = useMutation({
    mutationFn: (data: TransferInput) => createTransfer({ data }),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = queryClient.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      queryClient.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          newestTransactions([optimisticTransfer(data), ...current]),
      );
      return { previous };
    },
    onError: (_error, _data, context) =>
      queryClient.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
  });
  const importMutation = useMutation({
    mutationFn: (data: ImportTransactionsInput) => importTransactions({ data }),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.categories }),
    ]),
  });
  const createAccountMutation = useMutation({
    mutationFn: (name: string) => createAccount({ data: { name, kind: "bank_account" } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
  });
  const displayMoney = (cents: number) =>
    showValues ? money(cents) : "••••••";

  return (
    <main className="page-wrap rise-in py-6 sm:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-foreground">Visão geral</p>
          <h1 className="display-title text-3xl font-bold sm:text-4xl">
            Seu dinheiro, com clareza.
          </h1>
        </div>
        <div
          className="flex items-center gap-2"
          aria-label="Ações de transação"
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowValues((current) => !current)}
            aria-pressed={!showValues}
            aria-label={showValues ? "Ocultar valores" : "Mostrar valores"}
            title={showValues ? "Ocultar valores" : "Mostrar valores"}
          >
            {showValues ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
          <TransactionModal
            type="earn"
            accounts={accounts}
            categories={categories}
            onCreate={(data) => create.mutateAsync(data)}
            onCreateCategory={async (name, color, kind) =>
              (await createCategoryMutation.mutateAsync({ name, color, kind })).id
            }
            onDeleteCategory={removeCategory}
          />
          <TransactionModal
            type="expend"
            accounts={accounts}
            categories={categories}
            onCreate={(data) => create.mutateAsync(data)}
            onCreateCategory={async (name, color, kind) =>
              (await createCategoryMutation.mutateAsync({ name, color, kind })).id
            }
            onDeleteCategory={removeCategory}
          />
          <TransferModal
            compact
            accounts={accounts}
            onTransfer={async (data) => {
              await transfer.mutateAsync(data);
            }}
          />
          <ImportCsvModal
            transactions={transactions}
            accounts={accounts}
            onImport={(data) => importMutation.mutateAsync(data)}
            onCreateAccount={async (name) => (await createAccountMutation.mutateAsync(name)).id}
          />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm text-muted-foreground">
              {accountId ? "Saldo da conta" : "Saldo total"}
            </CardTitle>
            <Select
              value={accountId || EMPTY_SELECT_VALUE}
              onValueChange={(value) =>
                setAccountId(value === EMPTY_SELECT_VALUE ? "" : value)
              }
            >
              <SelectTrigger className="w-auto min-w-44" aria-label="Conta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>Todas as contas</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold sm:text-5xl">
              {displayMoney(balance)}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/transactions">
                  Gerenciar transações <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/report">
                  <BarChart3 className="size-4" /> Ver relatórios
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        {!accountId && accountBalances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Saldo por conta
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AccountBars rows={chartBalances} showValues={showValues} />
            </CardContent>
          </Card>
        )}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Receitas do mês"
          value={displayMoney(monthEarn)}
        />
        <StatTile
          label="Gasto no mês"
          value={displayMoney(monthExpend)}
          hint={
            monthForecastExpend
              ? `+ ${displayMoney(monthForecastExpend)} previsto`
              : undefined
          }
        />
        <StatTile
          label="Resultado do mês"
          value={displayMoney(monthEarn - monthExpend)}
          negative={monthEarn - monthExpend < 0}
          hint={
            monthRate === null
              ? "sem receita no mês"
              : `${monthRate > 0 ? "+" : ""}${Math.round(monthRate * 100)}% da receita`
          }
        />
        <StatTile
          label="Fatura atual"
          value={displayMoney(currentFaturasTotal)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Transações recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {transactions
            .filter(
              (transaction) =>
                transaction.date <= appToday() && inAccount(transaction)
            )
            .slice(0, 5)
            .map((transaction) => {
            const incoming =
              transaction.type === "earn" ||
              (!!accountId && transaction.counterAccountId === accountId);
            return (
            <div
              key={transaction.id}
              className="flex justify-between gap-3 border-b pb-3 last:border-0"
            >
              <span className="min-w-0 truncate">
                {transaction.note ||
                  (transaction.type === "earn" ? "Receita" : "Despesa")}
              </span>
              <span
                className={`shrink-0 ${
                  incoming ? "text-emerald-600" : "text-destructive"
                }`}
              >
                {incoming ? "+" : "−"}
                {displayMoney(transaction.amount)}
              </span>
            </div>
            );
          })}
          {!transactions.length && (
            <p className="text-muted-foreground">Nenhuma transação ainda.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * Mini column chart in the app's own vocabulary (bordered blocks, hard shadow)
 * instead of recharts' thin marks. ponytail: plain divs, ~6 bars never need a
 * chart lib; native title is the hover layer.
 */
function AccountBars({
  rows,
  showValues,
}: {
  rows: Array<{ name: string; balance: number }>;
  showValues: boolean;
}) {
  const compact = (cents: number) =>
    !showValues
      ? "•••"
      : (cents / 100).toLocaleString("pt-BR", {
          notation: "compact",
          maximumFractionDigits: 1,
        });
  const up = Math.max(0, ...rows.map((r) => r.balance));
  const down = Math.max(0, ...rows.map((r) => -r.balance));
  const zone = (cents: number, max: number) =>
    `${max ? Math.max((cents / max) * 100, 2) : 0}%`;
  const fill = (row: { name: string; balance: number }) =>
    row.name === "Outras"
      ? "bg-[var(--chart-other)]"
      : row.balance < 0
        ? "bg-destructive"
        : "bg-primary";

  return (
    <div>
      <div className={`flex h-36 pt-5 ${down ? "pb-5" : ""}`}>
        {rows.map((row) => (
          <div
            key={row.name}
            className="flex min-w-0 flex-1 flex-col"
            // Bars inset with padding, not gap, so the baseline runs unbroken.
            title={showValues ? `${row.name}: ${money(row.balance)}` : row.name}
          >
            <div
              className="flex flex-col justify-end border-b-2 border-foreground px-1"
              style={{ flex: up || 1 }}
            >
              {row.balance > 0 && (
                <div
                  className={`relative mx-auto w-full max-w-10 border-2 border-b-0 border-foreground ${fill(row)}`}
                  style={{ height: zone(row.balance, up) }}
                >
                  <span className="absolute inset-x-[-8px] -top-5 text-center text-[11px] font-bold tabular-nums">
                    {compact(row.balance)}
                  </span>
                </div>
              )}
            </div>
            {down > 0 && (
              <div className="flex flex-col px-1" style={{ flex: down }}>
                {row.balance < 0 && (
                  <div
                    className={`relative mx-auto w-full max-w-10 border-2 border-t-0 border-foreground ${fill(row)}`}
                    style={{ height: zone(-row.balance, down) }}
                  >
                    <span className="absolute inset-x-[-8px] -bottom-5 text-center text-[11px] font-bold tabular-nums">
                      {compact(row.balance)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex">
        {rows.map((row) => (
          <span
            key={row.name}
            className="min-w-0 flex-1 truncate px-0.5 text-center text-[10px] font-bold uppercase text-muted-foreground"
            title={row.name}
          >
            {row.name}
          </span>
        ))}
      </div>
    </div>
  );
}
