import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  listFaturas,
  markFaturaPaid,
  unmarkFaturaPaid,
} from "#/server/faturas";
import {
  listInstallmentPlans,
  listTransactions,
} from "#/server/transactions";
import { cycleKeyFor, faturaStatus } from "#/lib/faturas";
import { financeQueryKeys } from "#/lib/optimistic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DatePicker, localDateKey } from "@/components/ui/date-picker";

export const Route = createFileRoute("/_authed/faturas_/$accountId")({
  component: FaturaDetail,
});

const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const statusVariant = {
  open: "default",
  closed: "secondary",
  paid: "outline",
  overdue: "destructive",
} as const;
const statusLabel = {
  open: "aberta",
  closed: "fechada",
  paid: "paga",
  overdue: "atrasada",
} as const;

function FaturaDetail() {
  const { accountId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: faturas = [], isPending: faturasPending } = useQuery({
    queryKey: ["faturas"],
    queryFn: () => listFaturas(),
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listTransactions(),
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["installmentPlans"],
    queryFn: () => listInstallmentPlans(),
  });
  const cycles = useMemo(
    () => faturas.filter((fatura) => fatura.accountId === accountId),
    [accountId, faturas]
  );
  const [cycleIdx, setCycleIdx] = useState(0);
  const initializedAccount = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!cycles.length || initializedAccount.current === accountId) return;
    setCycleIdx(Math.max(0, cycles.findIndex((cycle) => cycle.isCurrent)));
    initializedAccount.current = accountId;
  }, [accountId, cycles]);
  useEffect(() => {
    if (cycleIdx >= cycles.length) setCycleIdx(Math.max(0, cycles.length - 1));
  }, [cycleIdx, cycles.length]);

  const selected = cycles[cycleIdx];
  const expenses = selected
    ? transactions.filter(
        (transaction) =>
          (transaction.type === "expend" || transaction.type === "earn") &&
          transaction.accountId === accountId &&
          cycleKeyFor(transaction.date, selected.closingDay) ===
            selected.cycleKey
      )
    : [];
  const planCounts = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.count])),
    [plans]
  );
  const installmentIndexes = useMemo(() => {
    const groups = new Map<string, typeof transactions>();
    for (const transaction of transactions) {
      if (!transaction.installmentPlanId) continue;
      const group = groups.get(transaction.installmentPlanId) ?? [];
      group.push(transaction);
      groups.set(transaction.installmentPlanId, group);
    }
    const indexes = new Map<string, number>();
    for (const group of groups.values()) {
      group.sort((a, b) => a.date.localeCompare(b.date));
      group.forEach((transaction, index) => indexes.set(transaction.id, index + 1));
    }
    return indexes;
  }, [transactions]);
  const setPaidOptimistically = async (cycleKey: string, paid: boolean) => {
    await queryClient.cancelQueries({ queryKey: financeQueryKeys.faturas });
    const previous = queryClient.getQueryData<typeof faturas>(
      financeQueryKeys.faturas,
    );
    const currentCycleKey =
      faturas.find(
        (fatura) => fatura.accountId === accountId && fatura.isCurrent,
      )?.cycleKey ?? cycleKey;
    const today = new Date().toISOString().slice(0, 10);
    queryClient.setQueryData<typeof faturas>(
      financeQueryKeys.faturas,
      (current = []) =>
        current.map((fatura) =>
          fatura.accountId === accountId && fatura.cycleKey === cycleKey
            ? {
                ...fatura,
                status: faturaStatus({
                  cycleKey,
                  currentCycleKey,
                  vencimento: fatura.vencimento,
                  today,
                  paid,
                }),
              }
            : fatura,
        ),
    );
    return { previous };
  };
  const rollbackPaid = (
    context: { previous: typeof faturas | undefined } | undefined,
  ) => queryClient.setQueryData(financeQueryKeys.faturas, context?.previous);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: financeQueryKeys.faturas });
  const markPaid = useMutation({
    mutationFn: ({ cycleKey, paidAt }: { cycleKey: string; paidAt: string }) =>
      markFaturaPaid({
        data: { account_id: accountId, cycle_key: cycleKey, paid_at: paidAt },
      }),
    onMutate: ({ cycleKey }) => setPaidOptimistically(cycleKey, true),
    onError: (_error, _vars, context) => rollbackPaid(context),
    onSettled: refresh,
  });
  const [payDate, setPayDate] = useState(localDateKey);
  const [askingPayDate, setAskingPayDate] = useState(false);
  const unmarkPaid = useMutation({
    mutationFn: (cycleKey: string) =>
      unmarkFaturaPaid({ data: { account_id: accountId, cycle_key: cycleKey } }),
    onMutate: (cycleKey) => setPaidOptimistically(cycleKey, false),
    onError: (_error, _cycleKey, context) => rollbackPaid(context),
    onSettled: refresh,
  });

  if (!faturasPending && !cycles.length) {
    return (
      <main className="page-wrap rise-in py-6 sm:py-10">
        <Link to="/faturas" className="mb-6 inline-flex items-center gap-2 font-medium">
          <ArrowLeft className="size-4" /> Voltar para faturas
        </Link>
        <Card>
          <CardContent className="p-6">Cartão não encontrado.</CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="page-wrap rise-in py-6 sm:py-10">
      <Link to="/faturas" className="mb-6 inline-flex items-center gap-2 font-medium">
        <ArrowLeft className="size-4" /> Voltar para faturas
      </Link>
      <Card className="mb-6">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>{selected?.accountName ?? "Fatura"}</CardTitle>
            {selected && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-bold sm:text-3xl">
                  {money(selected.total)}
                </span>
                <Badge variant={statusVariant[selected.status]}>
                  {statusLabel[selected.status]}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  vencimento {selected.vencimento}
                </span>
              </div>
            )}
          </div>
          {selected &&
            (selected.status === "paid" ? (
              <Button
                variant="outline"
                disabled={unmarkPaid.isPending}
                onClick={() => unmarkPaid.mutate(selected.cycleKey)}
              >
                Desmarcar paga
              </Button>
            ) : (
              <Button
                disabled={markPaid.isPending}
                onClick={() => {
                  setPayDate(localDateKey());
                  setAskingPayDate(true);
                }}
              >
                Marcar como paga
              </Button>
            ))}
        </CardHeader>
      </Card>
      <Dialog open={askingPayDate} onOpenChange={setAskingPayDate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quando a fatura foi paga?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fatura-pay-date">Data do pagamento</Label>
            <DatePicker id="fatura-pay-date" value={payDate} onChange={setPayDate} required />
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              disabled={markPaid.isPending}
              onClick={() => {
                if (!selected) return;
                markPaid.mutate({ cycleKey: selected.cycleKey, paidAt: payDate });
                setAskingPayDate(false);
              }}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-center gap-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fatura anterior"
              disabled={cycleIdx >= cycles.length - 1}
              onClick={() => setCycleIdx((index) => index + 1)}
            >
              <ChevronLeft />
            </Button>
            <CardTitle className="min-w-0 flex-1 text-center normal-case sm:min-w-40 sm:flex-none">
              {selected ? selected.label : "Carregando…"}
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Próxima fatura"
              disabled={cycleIdx <= 0}
              onClick={() => setCycleIdx((index) => index - 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Etiquetas</TableHead>
                <TableHead>Parcela</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>{expense.date}</TableCell>
                  <TableCell>{expense.note || "—"}</TableCell>
                  <TableCell className={expense.type === "earn" ? "text-emerald-600" : "text-destructive"}>
                    {expense.type === "earn" ? "+" : "−"}
                    {money(expense.amount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {expense.tags.map((tag) => (
                        <Badge key={tag.id} variant="outline" style={{ borderColor: tag.color, color: tag.color }}>
                          {tag.name}
                        </Badge>
                      ))}
                      {!expense.tags.length && "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {expense.installmentPlanId ? (
                      <Badge variant="outline">
                        {installmentIndexes.get(expense.id)}/
                        {planCounts.get(expense.installmentPlanId)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!expenses.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhuma despesa nesta fatura.
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
