import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { createAccount, listAccounts } from "#/server/accounts";
import { createCategory, listCategories } from "#/server/categories";
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
import { balanceOf } from "#/lib/money";
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
  const statsTransactions = transactions.filter(
    (
      transaction
    ): transaction is typeof transaction & { type: "earn" | "expend" } =>
      transaction.type !== "transfer"
  );
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthTransactions = statsTransactions.filter((transaction) =>
    transaction.date.startsWith(monthKey)
  );
  const sumByType = (type: "earn" | "expend") =>
    monthTransactions
      .filter((transaction) => transaction.type === type)
      .reduce((total, transaction) => total + transaction.amount, 0);
  const monthEarn = sumByType("earn");
  const monthExpend = sumByType("expend");
  const currentFaturasTotal = faturas
    .filter((fatura) => fatura.isCurrent)
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
  const createCategoryMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) => createCategory({ data }),
    onMutate: async ({ name, color }) => {
      await queryClient.cancelQueries({ queryKey: financeQueryKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(
        financeQueryKeys.categories,
      );
      const temporaryId = optimisticId();
      queryClient.setQueryData<Category[]>(
        financeQueryKeys.categories,
        (current = []) =>
          [...current, optimisticCategory(name, temporaryId, color)].sort((a, b) =>
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
            onCreateCategory={async (name, color) =>
              (await createCategoryMutation.mutateAsync({ name, color })).id
            }
          />
          <TransactionModal
            type="expend"
            accounts={accounts}
            categories={categories}
            onCreate={(data) => create.mutateAsync(data)}
            onCreateCategory={async (name, color) =>
              (await createCategoryMutation.mutateAsync({ name, color })).id
            }
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
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Saldo total
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold sm:text-5xl">
            {displayMoney(balanceOf(statsTransactions))}
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
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Receitas do mês"
          value={displayMoney(monthEarn)}
        />
        <StatTile
          label="Despesas do mês"
          value={displayMoney(monthExpend)}
        />
        <StatTile
          label="Resultado do mês"
          value={displayMoney(monthEarn - monthExpend)}
          negative={monthEarn - monthExpend < 0}
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
            .filter((transaction) => transaction.date <= appToday())
            .slice(0, 10)
            .map((transaction) => (
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
                  transaction.type === "earn"
                    ? "text-emerald-600"
                    : "text-destructive"
                }`}
              >
                {transaction.type === "earn" ? "+" : "−"}
                {displayMoney(transaction.amount)}
              </span>
            </div>
          ))}
          {!transactions.length && (
            <p className="text-muted-foreground">Nenhuma transação ainda.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
