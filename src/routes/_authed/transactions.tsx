import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { listAccounts } from "#/server/accounts";
import { createCategory, listCategories } from "#/server/categories";
import {
  createTransaction,
  createTransfer,
  deleteRecurrenceRule,
  deleteTransaction,
  listInstallmentPlans,
  listRecurrenceRules,
  listTransactions,
  updateTransaction,
} from "#/server/transactions";
import type {
  CreateTransactionInput,
  TransferInput,
  UpdateTransactionInput,
} from "#/server/schemas";
import type { Category, Transaction } from "#/db/schema";
import type {
  RecurrenceRuleRow,
  TransactionRow,
} from "#/server/transactions";
import {
  financeQueryKeys,
  newestTransactions,
  optimisticCategory,
  optimisticId,
  optimisticTransaction,
  optimisticUpdatedTransaction,
  optimisticTransfer,
} from "#/lib/optimistic";
import { localMonthKey, scheduledDatesInMonth } from "#/lib/recurrence";
import { CategorySelect } from "@/components/CategorySelect";
import { MonthNav } from "@/components/MonthNav";
import { MoneyInput } from "@/components/MoneyInput";
import { TransactionModal } from "@/components/TransactionModal";
import { TransferModal } from "@/components/TransferModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker, localDateKey } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMPTY_SELECT_VALUE,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authed/transactions")({
  component: Transactions,
});

type Repeat =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "installments";

type DisplayRow =
  | {
      kind: "transaction";
      key: string;
      date: string;
      type: Transaction["type"];
      amount: number;
      note: string | null;
      tags: TransactionRow["tags"];
      account?: string;
      counterAccount: string | null;
      badges: string[];
      installmentLabel: string | null;
      isRecurring: boolean;
      pending: boolean;
      tx: TransactionRow;
      onDelete: () => void;
    }
  | {
      kind: "scheduled";
      key: string;
      date: string;
      type: RecurrenceRuleRow["type"];
      amount: number;
      note: string | null;
      tags: RecurrenceRuleRow["tags"];
      account?: string;
      counterAccount: null;
      badges: string[];
      installmentLabel: null;
      isRecurring: boolean;
      pending: boolean;
      onDelete: () => void;
    };

const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const dayLabel = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });

const weekdayLabel = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("pt-BR", {
    weekday: "short",
    timeZone: "UTC",
  });

const kindLabel = (kind: string) =>
  kind === "credit_card" ? "cartão de crédito" : "conta bancária";

const signedPrefix = (type: Transaction["type"]) =>
  type === "earn" ? "+" : type === "expend" ? "−" : "";

function Transactions() {
  const qc = useQueryClient();
  const { data: transactions = [] } = useQuery({
    queryKey: financeQueryKeys.transactions,
    queryFn: () => listTransactions(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: financeQueryKeys.categories,
    queryFn: () => listCategories(),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: financeQueryKeys.accounts,
    queryFn: () => listAccounts(),
  });
  const { data: plans = [] } = useQuery({
    queryKey: financeQueryKeys.installmentPlans,
    queryFn: () => listInstallmentPlans(),
  });
  const { data: recurrenceRules = [] } = useQuery({
    queryKey: financeQueryKeys.recurrenceRules,
    queryFn: () => listRecurrenceRules(),
  });
  const [type, setType] = useState<"earn" | "expend">("expend");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(localDateKey);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [count, setCount] = useState("2");
  const [activeMonth, setActiveMonth] = useState(localMonthKey);
  const [filterAccount, setFilterAccount] = useState("");

  const selected = accounts.find((account) => account.id === accountId);
  const canInstall = type === "expend" && selected?.kind === "credit_card";

  useEffect(() => {
    if (repeat === "installments" && !canInstall) setRepeat("monthly");
  }, [repeat, canInstall]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.faturas }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.installmentPlans }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.recurrenceRules }),
    ]);

  const create = useMutation({
    mutationFn: (data: CreateTransactionInput) => createTransaction({ data }),
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = qc.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      qc.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          newestTransactions([optimisticTransaction(data), ...current]),
      );
      return { previous };
    },
    onError: (_error, _data, context) =>
      qc.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSuccess: () => {
      setAmount(null);
      setNote("");
      setRepeat("none");
    },
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: (data: UpdateTransactionInput) => updateTransaction({ data }),
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = qc.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      qc.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          newestTransactions(
            current.map((transaction) =>
              transaction.id === data.id
                ? optimisticUpdatedTransaction(transaction, data, categories)
                : transaction,
            ),
          ),
      );
      return { previous };
    },
    onError: (_error, _data, context) =>
      qc.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSettled: refresh,
  });

  const createCategoryMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      createCategory({ data }),
    onMutate: async ({ name, color }) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.categories });
      const previous = qc.getQueryData<Category[]>(financeQueryKeys.categories);
      const temporaryId = optimisticId();
      qc.setQueryData<Category[]>(
        financeQueryKeys.categories,
        (current = []) =>
          [...current, optimisticCategory(name, temporaryId, color)].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
      );
      return { previous, temporaryId };
    },
    onSuccess: ({ id }, _data, context) =>
      qc.setQueryData<Category[]>(
        financeQueryKeys.categories,
        (current = []) =>
          current.map((category) =>
            category.id === context?.temporaryId
              ? { ...category, id }
              : category,
          ),
      ),
    onError: (_error, _data, context) =>
      qc.setQueryData(financeQueryKeys.categories, context?.previous),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: financeQueryKeys.categories }),
  });

  const removeTx = useMutation({
    mutationFn: (id: string) => deleteTransaction({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = qc.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      qc.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) => current.filter((transaction) => transaction.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) =>
      qc.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSettled: refresh,
  });

  const removeRule = useMutation({
    mutationFn: (id: string) => deleteRecurrenceRule({ data: { id } }),
    onSettled: refresh,
  });

  const transfer = useMutation({
    mutationFn: (data: TransferInput) => createTransfer({ data }),
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.transactions });
      const previous = qc.getQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
      );
      qc.setQueryData<TransactionRow[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          newestTransactions([optimisticTransfer(data), ...current]),
      );
      return { previous };
    },
    onError: (_error, _data, context) =>
      qc.setQueryData(financeQueryKeys.transactions, context?.previous),
    onSettled: refresh,
  });

  const monthTx = transactions.filter(
    (transaction) =>
      transaction.date.slice(0, 7) === activeMonth &&
      (!filterAccount ||
        transaction.accountId === filterAccount ||
        transaction.counterAccountId === filterAccount),
  );

  const scheduled = useMemo(
    () =>
      filterAccount
        ? []
        : recurrenceRules.flatMap((rule) =>
            scheduledDatesInMonth(rule.interval, rule.nextRun, activeMonth).map(
              (date) => ({ rule, date }),
            ),
          ),
    [activeMonth, recurrenceRules, filterAccount],
  );

  const accountName = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const planCount = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.count])),
    [plans],
  );

  const installIndex = useMemo(() => {
    const groups = new Map<string, TransactionRow[]>();
    for (const transaction of transactions) {
      if (!transaction.installmentPlanId) continue;
      const group = groups.get(transaction.installmentPlanId) ?? [];
      group.push(transaction);
      groups.set(transaction.installmentPlanId, group);
    }
    const index = new Map<string, number>();
    for (const group of groups.values()) {
      group.sort((a, b) => a.date.localeCompare(b.date));
      group.forEach((transaction, position) =>
        index.set(transaction.id, position + 1),
      );
    }
    return index;
  }, [transactions]);

  const rows: DisplayRow[] = [
    ...monthTx.map((tx): DisplayRow => ({
      kind: "transaction",
      key: tx.id,
      date: tx.date,
      type: tx.type,
      amount: tx.amount,
      note: tx.note,
      tags: tx.tags,
      account: accountName.get(tx.accountId ?? ""),
      counterAccount: tx.counterAccountId
        ? (accountName.get(tx.counterAccountId) ?? "—")
        : null,
      badges: [],
      installmentLabel: tx.installmentPlanId
        ? `${installIndex.get(tx.id)}/${planCount.get(tx.installmentPlanId)}`
        : null,
      isRecurring: Boolean(tx.recurrenceRuleId),
      pending: tx.userId === "optimistic",
      tx,
      onDelete: () => removeTx.mutate(tx.id),
    })),
    ...scheduled.map(({ rule, date }): DisplayRow => ({
      kind: "scheduled",
      key: `scheduled-${rule.id}-${date}`,
      date,
      type: rule.type,
      amount: rule.amount,
      note: rule.note,
      tags: rule.tags,
      account: undefined,
      counterAccount: null,
      badges: [],
      installmentLabel: null,
      isRecurring: true,
      pending: removeRule.isPending,
      onDelete: () => {
        if (
          window.confirm(
            "Excluir esta recorrência? Isso apaga todo o histórico gerado por ela.",
          )
        )
          removeRule.mutate(rule.id);
      },
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <main className="page-wrap rise-in py-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="display-title text-3xl font-bold sm:text-4xl">
          Transações
        </h1>
        <TransferModal
          accounts={accounts}
          onTransfer={async (data) => {
            await transfer.mutateAsync(data);
          }}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Adicionar transação</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (amount === null || amount <= 0) return;
              create.mutate({
                type,
                amount,
                date,
                tag_ids: tagIds.length ? tagIds : undefined,
                account_id: accountId || undefined,
                note: note || undefined,
                recurrence:
                  repeat !== "none" && repeat !== "installments"
                    ? { interval: repeat }
                    : undefined,
                installments:
                  repeat === "installments"
                    ? { count: Number(count) }
                    : undefined,
              });
            }}
          >
            <Field label="Nome" htmlFor="transaction-page-note">
              <Input
                id="transaction-page-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <Select
                value={type}
                onValueChange={(value) => setType(value as typeof type)}
              >
                <SelectTrigger aria-label="Tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expend">Despesa</SelectItem>
                  <SelectItem value="earn">Receita</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Valor (R$)" htmlFor="transaction-page-amount">
              <MoneyInput
                id="transaction-page-amount"
                value={amount}
                onValueChange={setAmount}
                required
              />
            </Field>
            <Field label="Data" htmlFor="transaction-page-date">
              <DatePicker
                id="transaction-page-date"
                value={date}
                onChange={setDate}
                required
              />
            </Field>
            <Field label="Etiquetas">
              <CategorySelect
                categories={categories}
                value={tagIds}
                onChange={setTagIds}
                onCreate={async (name, color) =>
                  (await createCategoryMutation.mutateAsync({ name, color })).id
                }
              />
            </Field>
            <Field label="Conta">
              <Select
                value={accountId || EMPTY_SELECT_VALUE}
                onValueChange={(value) =>
                  setAccountId(value === EMPTY_SELECT_VALUE ? "" : value)
                }
              >
                <SelectTrigger aria-label="Conta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>Nenhuma</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} · {kindLabel(account.kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Repetir">
              <Select
                value={repeat}
                onValueChange={(value) => setRepeat(value as Repeat)}
              >
                <SelectTrigger aria-label="Repetir">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não repetir</SelectItem>
                  <SelectItem value="daily">Diária</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                  <SelectItem value="installments" disabled={!canInstall}>
                    Parcelado…
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {repeat === "installments" && (
              <Field
                label="Número de parcelas"
                htmlFor="transaction-page-installments"
              >
                <Input
                  id="transaction-page-installments"
                  type="number"
                  min="2"
                  max="60"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
              </Field>
            )}
            <div className="flex items-end sm:pb-2">
              <Button className="w-full sm:w-auto" disabled={create.isPending}>
                Adicionar transação
              </Button>
            </div>
            {create.error && (
              <p className="text-sm text-destructive sm:col-span-full">
                {create.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Todas as transações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4 flex flex-wrap items-center justify-center gap-4">
            <MonthNav month={activeMonth} onChange={setActiveMonth} />
            <div className="w-full sm:absolute sm:inset-y-0 sm:right-0 sm:flex sm:w-auto sm:items-center">
              <Select
                value={filterAccount || EMPTY_SELECT_VALUE}
                onValueChange={(value) =>
                  setFilterAccount(value === EMPTY_SELECT_VALUE ? "" : value)
                }
              >
                <SelectTrigger
                  aria-label="Filtrar por conta"
                  className="w-full sm:w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    Todas as contas
                  </SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="hidden sm:table-cell">Etiquetas</TableHead>
                <TableHead className="hidden md:table-cell">Conta</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                    <TableCell className="align-top tabular-nums">
                      <div className="font-medium">{dayLabel(row.date)}</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {weekdayLabel(row.date)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        {row.badges.map((badge) => (
                          <Badge key={badge} variant="outline">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                      <div
                        className={
                          row.note
                            ? "mt-1 font-medium"
                            : "mt-1 text-muted-foreground"
                        }
                      >
                        {row.note || "Sem descrição"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground md:hidden">
                        <span className="sm:hidden">
                          {row.tags.length
                            ? row.tags.map((tag) => tag.name).join(", ")
                            : "—"}{" "}
                          ·{" "}
                        </span>
                        {row.account ?? "—"}
                        {row.counterAccount && ` → ${row.counterAccount}`}
                      </div>
                    </TableCell>
                    <TableCell className="hidden align-top sm:table-cell">
                      <TagList tags={row.tags} />
                    </TableCell>
                    <TableCell className="hidden align-top text-muted-foreground md:table-cell">
                      {row.account ?? "—"}
                      {row.counterAccount && ` → ${row.counterAccount}`}
                    </TableCell>
                    <TableCell
                      className={`align-top text-right font-bold tabular-nums ${
                        row.type === "earn"
                          ? "text-emerald-600"
                          : row.type === "expend"
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {row.isRecurring && (
                          <RefreshCw
                            aria-label="recorrente"
                            className="size-3.5 text-muted-foreground"
                          />
                        )}
                        {row.installmentLabel && (
                          <span className="text-xs text-muted-foreground">
                            ({row.installmentLabel})
                          </span>
                        )}
                        <span>
                          {signedPrefix(row.type)}
                          {money(row.amount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-2">
                        {row.kind === "transaction" &&
                          !row.tx.installmentPlanId &&
                          row.tx.type !== "transfer" && (
                            <TransactionModal
                              type={row.tx.type}
                              accounts={accounts}
                              categories={categories}
                              initialTransaction={{ ...row.tx, type: row.tx.type }}
                              onUpdate={(data) => update.mutateAsync(data)}
                              onCreateCategory={async (name, color) =>
                                (
                                  await createCategoryMutation.mutateAsync({
                                    name,
                                    color,
                                  })
                                ).id
                              }
                              trigger={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Editar"
                                  className="size-8"
                                  disabled={row.pending}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                              }
                            />
                          )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          className="size-8 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          disabled={row.pending}
                          onClick={row.onDelete}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Nenhuma transação neste mês.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}

function TagList({ tags }: { tags: TransactionRow["tags"] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          style={{ borderColor: tag.color, color: tag.color }}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
