import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pencil, RefreshCw, Save, Trash2, TriangleAlert, X } from "lucide-react";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listPluggyAccounts,
  setAccountIncludeInTotal,
  syncAccountNow,
  updateAccount,
} from "#/server/accounts";
import { listFaturas } from "#/server/faturas";
import { listTransactions } from "#/server/transactions";
import type { Account } from "#/db/schema";
import type { UpdateAccountInput } from "#/server/schemas";
import { appToday } from "#/lib/dates";
import { pluggyFloor } from "#/lib/pluggy-sync";
import { availableLimit } from "#/lib/faturas";
import { countsInTotal, prepaidBalanceOf } from "#/lib/money";
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
type CryptoForm = {
  enabled: boolean;
  provider: "crypto" | "pluggy";
  pluggyAccountId: string;
  walletAddress: string;
  syncKind: "wallet" | "etherfi_cash";
  syncSince: string;
  syncEnabled: boolean;
};
type CryptoInput =
  | { walletAddress: null; pluggyAccountId: null }
  | {
      walletAddress: string;
      syncKind: CryptoForm["syncKind"];
      syncSince: string;
      syncEnabled: boolean;
    }
  | { pluggyAccountId: string; syncSince: string; syncEnabled: boolean };
type AccountFormInput = {
  name: string;
  kind: "credit_card" | "bank_account";
  limit?: number;
  closingDay?: number;
  dueDay?: number;
  prepaid?: boolean;
} & CryptoInput;
const emptyCrypto = (): CryptoForm => ({
  enabled: false,
  provider: "crypto",
  pluggyAccountId: "",
  walletAddress: "",
  syncKind: "wallet",
  syncSince: appToday(),
  syncEnabled: true,
});
const cryptoFromAccount = (a: Account): CryptoForm =>
  a.walletAddress || a.pluggyAccountId
    ? {
        enabled: true,
        provider: a.pluggyAccountId ? "pluggy" : "crypto",
        pluggyAccountId: a.pluggyAccountId ?? "",
        walletAddress: a.walletAddress ?? "",
        syncKind: a.syncKind && a.syncKind !== "pluggy" ? a.syncKind : "wallet",
        // Pluggy reads at most 30 days back, so an older date is the same as the floor (and would fail `min`).
        syncSince: a.pluggyAccountId && a.syncSince && a.syncSince < pluggyFloor() ? pluggyFloor() : a.syncSince ?? appToday(),
        syncEnabled: a.syncEnabled,
      }
    : emptyCrypto();
const cryptoInput = (f: CryptoForm): CryptoInput =>
  !f.enabled
    ? { walletAddress: null, pluggyAccountId: null }
    : f.provider === "pluggy"
      ? { pluggyAccountId: f.pluggyAccountId, syncSince: f.syncSince, syncEnabled: f.syncEnabled }
      : { walletAddress: f.walletAddress.trim(), syncKind: f.syncKind, syncSince: f.syncSince, syncEnabled: f.syncEnabled };
const syncedAgo = (at: Date | string | null) => {
  if (!at) return "nunca sincronizado";
  const minutes = Math.round((new Date(at).getTime() - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (minutes > -60) return `sincronizado ${rtf.format(minutes, "minute")}`;
  if (minutes > -1440)
    return `sincronizado ${rtf.format(Math.round(minutes / 60), "hour")}`;
  return `sincronizado ${rtf.format(Math.round(minutes / 1440), "day")}`;
};
type PluggyOptions = { enabled: boolean; accounts: { id: string; name: string; type: string; number: string | null }[] };
function CryptoFields({
  id,
  value,
  onChange,
  pluggy,
}: {
  id: string;
  value: CryptoForm;
  onChange: (value: CryptoForm) => void;
  pluggy?: PluggyOptions;
}) {
  const set = (patch: Partial<CryptoForm>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="grid gap-4 border-t-2 border-foreground pt-3 sm:col-span-3 sm:grid-cols-3">
      <legend className="sr-only">Sincronização automática</legend>
      <Label
        htmlFor={`${id}-crypto`}
        className="flex min-h-10 cursor-pointer items-center gap-3 uppercase sm:col-span-3"
      >
        <Checkbox
          id={`${id}-crypto`}
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Sincronização automática
      </Label>
      {value.enabled && pluggy?.enabled && (
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor={`${id}-provider`}>Fonte</Label>
          <Select
            value={value.provider}
            onValueChange={(provider) => set({ provider: provider as CryptoForm["provider"] })}
          >
            <SelectTrigger id={`${id}-provider`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crypto">Cripto (carteira)</SelectItem>
              <SelectItem value="pluggy">Open Finance (Pluggy)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {value.enabled && value.provider === "pluggy" && (
        <>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-pluggy`}>Conta no Open Finance</Label>
            <Select
              value={value.pluggyAccountId}
              onValueChange={(pluggyAccountId) => set({ pluggyAccountId })}
            >
              <SelectTrigger id={`${id}-pluggy`}>
                <SelectValue placeholder="Escolha a conta" />
              </SelectTrigger>
              <SelectContent>
                {pluggy?.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.number ? ` · ${a.number}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Select has no native validation: block submit until an account is chosen. */}
            <input
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              value={value.pluggyAccountId}
              onChange={() => {}}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-pluggy-since`}>Importar desde</Label>
            <Input
              id={`${id}-pluggy-since`}
              type="date"
              value={value.syncSince}
              min={pluggyFloor()}
              max={appToday()}
              onChange={(e) => set({ syncSince: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">Até 30 dias atrás.</p>
          </div>
          <div className="flex items-end sm:col-span-3">
            <Label
              htmlFor={`${id}-pluggy-auto`}
              className="flex min-h-10 cursor-pointer items-center gap-3 uppercase"
            >
              <Checkbox
                id={`${id}-pluggy-auto`}
                checked={value.syncEnabled}
                onChange={(e) => set({ syncEnabled: e.target.checked })}
              />
              Sincronizar automaticamente
            </Label>
          </div>
        </>
      )}
      {value.enabled && value.provider === "crypto" && (
        <>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-address`}>Endereço da carteira</Label>
            <Input
              id={`${id}-address`}
              value={value.walletAddress}
              onChange={(e) => set({ walletAddress: e.target.value })}
              placeholder="0x…"
              pattern="^0x[0-9a-fA-F]{40}$"
              title="0x seguido de 40 caracteres hexadecimais"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-sync-kind`}>Origem</Label>
            <Select
              value={value.syncKind}
              onValueChange={(syncKind) =>
                set({ syncKind: syncKind as CryptoForm["syncKind"] })
              }
            >
              <SelectTrigger id={`${id}-sync-kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wallet">Carteira (Base)</SelectItem>
                <SelectItem value="etherfi_cash">ether.fi Cash (OP)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-since`}>Importar desde</Label>
            <Input
              id={`${id}-since`}
              type="date"
              value={value.syncSince}
              max={appToday()}
              onChange={(e) => set({ syncSince: e.target.value })}
              required
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Label
              htmlFor={`${id}-auto`}
              className="flex min-h-10 cursor-pointer items-center gap-3 uppercase"
            >
              <Checkbox
                id={`${id}-auto`}
                checked={value.syncEnabled}
                onChange={(e) => set({ syncEnabled: e.target.checked })}
              />
              Sincronizar automaticamente
            </Label>
          </div>
        </>
      )}
    </fieldset>
  );
}
function Accounts() {
  const qc = useQueryClient(),
    [name, setName] = useState(""),
    [kind, setKind] = useState<"credit_card" | "bank_account">("bank_account"),
    [limit, setLimit] = useState(""),
    [closingDay, setClosingDay] = useState(""),
    [dueDay, setDueDay] = useState(""),
    [prepaid, setPrepaid] = useState(false),
    [crypto, setCrypto] = useState(emptyCrypto);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState<"credit_card" | "bank_account">(
    "bank_account",
  );
  const [editLimit, setEditLimit] = useState("");
  const [editClosingDay, setEditClosingDay] = useState("");
  const [editDueDay, setEditDueDay] = useState("");
  const [editPrepaid, setEditPrepaid] = useState(false);
  const [editCrypto, setEditCrypto] = useState(emptyCrypto);
  const [editError, setEditError] = useState("");
  const { data = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    // Background sync (claimed on load): poll until it finishes so the spinner stops on time.
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.syncing) ? 2_000 : false,
  });
  const { data: pluggy } = useQuery({
    queryKey: ["pluggy-accounts"],
    queryFn: () => listPluggyAccounts(),
    staleTime: 5 * 60_000,
  });
  const { data: faturas = [] } = useQuery({
    queryKey: ["faturas"],
    queryFn: () => listFaturas(),
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listTransactions(),
  });
  const invalidateAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: financeQueryKeys.accounts }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.transactions }),
      qc.invalidateQueries({ queryKey: financeQueryKeys.faturas }),
    ]);
  // Synced rows land in transactions/faturas: refresh them when a background sync ends.
  const syncing = data.some((a) => a.syncing);
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing) void invalidateAll();
    wasSyncing.current = syncing;
  }, [syncing]);
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
      setCrypto(emptyCrypto());
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
    setEditCrypto(emptyCrypto());
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
    setEditCrypto(cryptoFromAccount(account));
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
    ...cryptoInput(editCrypto),
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
                ? optimisticAccount(
                    { includeInTotal: account.includeInTotal, ...input },
                    account.id,
                  )
                : account,
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
      );
      return { previous };
    },
    onSuccess: clearEdit,
    onError: (_error, _input, context) =>
      qc.setQueryData(financeQueryKeys.accounts, context?.previous),
    onSettled: invalidateAll,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAccount({ data: { id } }),
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: financeQueryKeys.accounts }),
        qc.cancelQueries({ queryKey: financeQueryKeys.faturas }),
      ]);
      const previousAccounts = qc.getQueryData<Account[]>(
        financeQueryKeys.accounts,
      );
      const previousFaturas = qc.getQueryData<typeof faturas>(
        financeQueryKeys.faturas,
      );
      qc.setQueryData<Account[]>(financeQueryKeys.accounts, (current = []) =>
        current.filter((account) => account.id !== id),
      );
      qc.setQueryData<typeof faturas>(
        financeQueryKeys.faturas,
        (current = []) => current.filter((fatura) => fatura.accountId !== id),
      );
      return { previousAccounts, previousFaturas };
    },
    onError: (_error, _id, context) => {
      qc.setQueryData(financeQueryKeys.accounts, context?.previousAccounts);
      qc.setQueryData(financeQueryKeys.faturas, context?.previousFaturas);
    },
    onSettled: invalidateAll,
  });
  const toggleTotal = useMutation({
    mutationFn: (input: { id: string; includeInTotal: boolean }) =>
      setAccountIncludeInTotal({ data: input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: financeQueryKeys.accounts });
      const previous = qc.getQueryData<Account[]>(financeQueryKeys.accounts);
      qc.setQueryData<Account[]>(financeQueryKeys.accounts, (current = []) =>
        current.map((account) =>
          account.id === input.id
            ? { ...account, includeInTotal: input.includeInTotal }
            : account,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      qc.setQueryData(financeQueryKeys.accounts, context?.previous),
    onSettled: invalidateAll,
  });
  const sync = useMutation({
    mutationFn: (id: string) => syncAccountNow({ data: { id } }),
    onSettled: invalidateAll,
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
                ...cryptoInput(crypto),
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
            <CryptoFields id="new" value={crypto} onChange={setCrypto} pluggy={pluggy} />
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
          {remove.error && (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          )}
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
                {(a.walletAddress || a.pluggyAccountId) && (
                  <span className="text-sm text-muted-foreground">
                    {a.walletAddress
                      ? `${a.walletAddress.slice(0, 6)}…${a.walletAddress.slice(-4)}`
                      : "Open Finance"}{" "}
                    ·{" "}
                    {a.syncing
                      ? "sincronizando…"
                      : a.lastSyncError
                        ? "sincronização falhou"
                        : syncedAgo(a.lastSyncedAt)}
                  </span>
                )}
                <Label
                  htmlFor={`include-total-${a.id}`}
                  className="ml-auto flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`include-total-${a.id}`}
                    checked={countsInTotal(a)}
                    disabled={a.kind === "credit_card" && !a.prepaid}
                    title={a.kind === "credit_card" && !a.prepaid ? "Cartão de crédito não entra no saldo" : undefined}
                    onChange={(e) =>
                      toggleTotal.mutate({
                        id: a.id,
                        includeInTotal: e.target.checked,
                      })
                    }
                  />
                  No saldo total
                </Label>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Editar"
                  title="Editar"
                  onClick={() => beginEdit(a)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  className="size-8"
                  aria-label="Excluir"
                  title="Excluir"
                  onClick={() => {
                    if (
                      window.confirm(`Excluir "${a.name}"?`)
                    )
                      remove.mutate(a.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
                {(a.walletAddress || a.pluggyAccountId) && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Sincronizar"
                    title="Sincronizar"
                    disabled={a.syncing || (sync.isPending && sync.variables === a.id)}
                    onClick={() => sync.mutate(a.id)}
                  >
                    <RefreshCw
                      className={`size-4 ${a.syncing || (sync.isPending && sync.variables === a.id) ? "animate-spin" : ""}`}
                    />
                  </Button>
                )}
                {(a.walletAddress || a.pluggyAccountId) && a.lastSyncError && (
                  <p
                    role="alert"
                    className="flex w-full items-start gap-2 border-2 border-destructive bg-destructive/10 p-2 text-sm"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <span>Erro na sincronização: {a.lastSyncError}</span>
                  </p>
                )}
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
                    <CryptoFields
                      id={a.id}
                      value={editCrypto}
                      onChange={setEditCrypto}
                      pluggy={pluggy}
                    />
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
