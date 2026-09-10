import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from "#/server/accounts";
import { listFaturas } from "#/server/faturas";
import { listTransactions } from "#/server/transactions";
import type { Account, Transaction } from "#/db/schema";
import type { UpdateAccountInput } from "#/server/schemas";
import { availableLimit } from "#/lib/faturas";
import { prepaidBalanceOf } from "#/lib/money";
import {
  financeQueryKeys,
  optimisticAccount,
  optimisticId,
} from "#/lib/optimistic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export const Route = createFileRoute("/_authed/accounts")({
  component: Accounts,
});
const money = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kindLabel = (k: string) =>
  k === "credit_card" ? "cartão de crédito" : "conta bancária";
type AccountFormInput = {
  name: string;
  kind: "credit_card" | "bank_account";
  limit?: number;
  closingDay?: number;
  dueDay?: number;
  prepaid?: boolean;
};
function Accounts() {
  const qc = useQueryClient(),
    [name, setName] = useState(""),
    [kind, setKind] = useState<"credit_card" | "bank_account">("bank_account"),
    [limit, setLimit] = useState(""),
    [closingDay, setClosingDay] = useState(""),
    [dueDay, setDueDay] = useState(""),
    [prepaid, setPrepaid] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState<"credit_card" | "bank_account">(
    "bank_account",
  );
  const [editLimit, setEditLimit] = useState("");
  const [editClosingDay, setEditClosingDay] = useState("");
  const [editDueDay, setEditDueDay] = useState("");
  const [editPrepaid, setEditPrepaid] = useState(false);
  const [editError, setEditError] = useState("");
  const { data = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
  });
  const { data: faturas = [] } = useQuery({
    queryKey: ["faturas"],
    queryFn: () => listFaturas(),
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listTransactions(),
  });
  const create = useMutation({
    mutationFn: (d: AccountFormInput) => createAccount({ data: d }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.accounts });
      const previous = qc.getQueryData<Account[]>(financeQueryKeys.accounts);
      const temporaryId = optimisticId();
      qc.setQueryData<Account[]>(
        financeQueryKeys.accounts,
        (current = []) =>
          [...current, optimisticAccount(input, temporaryId)].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
      );
      return { previous, temporaryId };
    },
    onSuccess: ({ id }, _input, context) => {
      qc.setQueryData<Account[]>(
        financeQueryKeys.accounts,
        (current = []) =>
          current.map((account) =>
            account.id === context?.temporaryId ? { ...account, id } : account,
          ),
      );
      setName("");
      setLimit("");
      setClosingDay("");
      setDueDay("");
      setPrepaid(false);
    },
    onError: (_error, _input, context) =>
      qc.setQueryData(financeQueryKeys.accounts, context?.previous),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
  });
  const clearEdit = () => {
    setEditId("");
    setEditName("");
    setEditKind("bank_account");
    setEditLimit("");
    setEditClosingDay("");
    setEditDueDay("");
    setEditPrepaid(false);
    setEditError("");
  };
  const beginEdit = (account: Account) => {
    setEditError("");
    setEditId(account.id);
    setEditName(account.name);
    setEditKind(account.kind);
    setEditLimit(account.limit == null ? "" : String(account.limit / 100));
    setEditClosingDay(account.closingDay == null ? "" : String(account.closingDay));
    setEditDueDay(account.dueDay == null ? "" : String(account.dueDay));
    setEditPrepaid(account.prepaid);
  };
  const editedInput = (): UpdateAccountInput => ({
    id: editId,
    name: editName.trim(),
    kind: editKind,
    limit:
      editKind === "credit_card" && !editPrepaid && editLimit
        ? Math.round(Number(editLimit) * 100)
        : undefined,
    closingDay:
      editKind === "credit_card" && !editPrepaid && editClosingDay
        ? Number(editClosingDay)
        : undefined,
    dueDay:
      editKind === "credit_card" && !editPrepaid && editDueDay
        ? Number(editDueDay)
        : undefined,
    prepaid: editKind === "credit_card" ? editPrepaid : undefined,
  });
  const update = useMutation({
    mutationFn: (input: UpdateAccountInput) => updateAccount({ data: input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.accounts });
      const previous = qc.getQueryData<Account[]>(financeQueryKeys.accounts);
      qc.setQueryData<Account[]>(
        financeQueryKeys.accounts,
        (current = []) =>
          current
            .map((account) =>
              account.id === input.id
                ? optimisticAccount(input, account.id)
                : account,
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
      );
      return { previous };
    },
    onSuccess: clearEdit,
    onError: (_error, _input, context) =>
      qc.setQueryData(financeQueryKeys.accounts, context?.previous),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
        qc.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
        qc.invalidateQueries({ queryKey: financeQueryKeys.faturas }),
      ]),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAccount({ data: { id } }),
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: financeQueryKeys.accounts }),
        qc.cancelQueries({ queryKey: financeQueryKeys.transactions }),
        qc.cancelQueries({ queryKey: financeQueryKeys.faturas }),
      ]);
      const previousAccounts = qc.getQueryData<Account[]>(
        financeQueryKeys.accounts,
      );
      const previousTransactions = qc.getQueryData<Transaction[]>(
        financeQueryKeys.transactions,
      );
      const previousFaturas = qc.getQueryData<typeof faturas>(
        financeQueryKeys.faturas,
      );
      qc.setQueryData<Account[]>(financeQueryKeys.accounts, (current = []) =>
        current.filter((account) => account.id !== id),
      );
      qc.setQueryData<Transaction[]>(
        financeQueryKeys.transactions,
        (current = []) =>
          current.map((transaction) => ({
            ...transaction,
            accountId:
              transaction.accountId === id ? null : transaction.accountId,
            counterAccountId:
              transaction.counterAccountId === id
                ? null
                : transaction.counterAccountId,
          })),
      );
      qc.setQueryData<typeof faturas>(
        financeQueryKeys.faturas,
        (current = []) => current.filter((fatura) => fatura.accountId !== id),
      );
      return { previousAccounts, previousTransactions, previousFaturas };
    },
    onError: (_error, _id, context) => {
      qc.setQueryData(financeQueryKeys.accounts, context?.previousAccounts);
      qc.setQueryData(
        financeQueryKeys.transactions,
        context?.previousTransactions,
      );
      qc.setQueryData(financeQueryKeys.faturas, context?.previousFaturas);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
        qc.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
        qc.invalidateQueries({ queryKey: financeQueryKeys.faturas }),
      ]),
  });
  return (
    <main className="page-wrap rise-in py-6 sm:py-10">
      <h1 className="display-title mb-6 text-3xl font-bold sm:text-4xl">
        Contas
      </h1>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Adicionar conta</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({
                name: name.trim(),
                kind,
                limit:
                  kind === "credit_card" && !prepaid && limit
                    ? Math.round(Number(limit) * 100)
                    : undefined,
                closingDay:
                  kind === "credit_card" && !prepaid && closingDay
                    ? Number(closingDay)
                    : undefined,
                dueDay:
                  kind === "credit_card" && !prepaid && dueDay
                    ? Number(dueDay)
                    : undefined,
                prepaid: kind === "credit_card" ? prepaid : undefined,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="account-name">Nome</Label>
              <Input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as typeof kind)}
              >
                <SelectTrigger id="account-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_account">Conta bancária</SelectItem>
                  <SelectItem value="credit_card">
                    Cartão de crédito
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "credit_card" && (
              <div className="flex items-end">
                <Label
                  htmlFor="prepaid"
                  className="flex min-h-10 cursor-pointer items-center gap-3 uppercase"
                >
                  <Checkbox
                    id="prepaid"
                    checked={prepaid}
                    onChange={(e) => setPrepaid(e.target.checked)}
                  />
                  Cartão pré-pago
                </Label>
              </div>
            )}
            {kind === "credit_card" && !prepaid && (
              <div className="space-y-2">
                <Label>Limite (R$)</Label>
                <Input
                  type="number"
                  min="0"
                  step=".01"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
            )}
            {kind === "credit_card" && !prepaid && (
              <div className="space-y-2">
                <Label>Dia de fechamento</Label>
                <Input
                  type="number"
                  min="1"
                  max="28"
                  value={closingDay}
                  onChange={(e) => setClosingDay(e.target.value)}
                  required
                />
              </div>
            )}
            {kind === "credit_card" && !prepaid && (
              <div className="space-y-2">
                <Label>Dia de vencimento</Label>
                <Input
                  type="number"
                  min="1"
                  max="28"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  required
                />
              </div>
            )}
            <Button className="w-full sm:col-span-3 sm:w-fit">
              Adicionar conta
            </Button>
            {create.error && (
              <p className="text-sm text-destructive sm:col-span-3">
                {create.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Todas as contas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.map((a) => {
            const cardFaturas = faturas.filter((f) => f.accountId === a.id);
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-2 border-foreground bg-card p-3"
              >
                <span className="font-medium">{a.name}</span>
                <Badge variant="secondary">{kindLabel(a.kind)}</Badge>
                {a.kind === "credit_card" && a.prepaid && (
                  <span className="text-sm text-muted-foreground">
                    Saldo {money(prepaidBalanceOf(a.id, transactions))}
                  </span>
                )}
                {a.kind === "credit_card" && !a.prepaid && a.limit != null && (
                  <span className="text-sm text-muted-foreground">
                    Disponível {money(availableLimit(a.limit, cardFaturas))} /{" "}
                    {money(a.limit)}
                  </span>
                )}
                <Button
                  className="ml-auto"
                  variant="outline"
                  size="sm"
                  onClick={() => beginEdit(a)}
                >
                  <Pencil className="size-4" />
                  Editar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        a.kind === "credit_card"
                          ? `Excluir "${a.name}"? Isso também apaga as compras parceladas deste cartão.`
                          : `Excluir "${a.name}"?`,
                      )
                    )
                      remove.mutate(a.id);
                  }}
                >
                  Excluir
                </Button>
                {editId === a.id && (
                  <form
                    className="grid w-full gap-4 border-t-2 border-foreground pt-3 sm:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        editKind === "credit_card" &&
                        !editPrepaid &&
                        (!editClosingDay || !editDueDay)
                      ) {
                        setEditError(
                          "Informe o dia de fechamento e de vencimento.",
                        );
                        return;
                      }
                      setEditError("");
                      update.mutate(editedInput());
                    }}
                  >
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`account-kind-${a.id}`}>Tipo</Label>
                      <Select
                        value={editKind}
                        onValueChange={(value) =>
                          setEditKind(value as typeof editKind)
                        }
                      >
                        <SelectTrigger id={`account-kind-${a.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bank_account">
                            Conta bancária
                          </SelectItem>
                          <SelectItem value="credit_card">
                            Cartão de crédito
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {editKind === "credit_card" && (
                      <div className="flex items-end">
                        <Label
                          htmlFor={`prepaid-${a.id}`}
                          className="flex min-h-10 cursor-pointer items-center gap-3 uppercase"
                        >
                          <Checkbox
                            id={`prepaid-${a.id}`}
                            checked={editPrepaid}
                            onChange={(e) => setEditPrepaid(e.target.checked)}
                          />
                          Cartão pré-pago
                        </Label>
                      </div>
                    )}
                    {editKind === "credit_card" && !editPrepaid && (
                      <div className="space-y-2">
                        <Label>Limite (R$)</Label>
                        <Input
                          type="number"
                          min="0"
                          step=".01"
                          value={editLimit}
                          onChange={(e) => setEditLimit(e.target.value)}
                        />
                      </div>
                    )}
                    {editKind === "credit_card" && !editPrepaid && (
                      <div className="space-y-2">
                        <Label>Dia de fechamento</Label>
                        <Input
                          type="number"
                          min="1"
                          max="28"
                          value={editClosingDay}
                          onChange={(e) => setEditClosingDay(e.target.value)}
                        />
                      </div>
                    )}
                    {editKind === "credit_card" && !editPrepaid && (
                      <div className="space-y-2">
                        <Label>Dia de vencimento</Label>
                        <Input
                          type="number"
                          min="1"
                          max="28"
                          value={editDueDay}
                          onChange={(e) => setEditDueDay(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex gap-2 sm:col-span-3">
                      <Button disabled={update.isPending}>
                        <Save className="size-4" />
                        Salvar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={clearEdit}
                      >
                        <X className="size-4" />
                        Cancelar
                      </Button>
                    </div>
                    {(editError || update.error) && (
                      <p
                        role="alert"
                        className="text-sm text-destructive sm:col-span-3"
                      >
                        {editError || update.error?.message}
                      </p>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
