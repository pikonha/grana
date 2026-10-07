import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
} from "#/server/schemas";
import { CategorySelect, type CategorySelectProps } from "./CategorySelect";
import { MoneyInput } from "./MoneyInput";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { DatePicker, localDateKey } from "./ui/date-picker";

type RepeatInterval =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "installments";
type CategoryOption = { id: string; name: string; color: string; kind: "earn" | "expend" };
type AccountOption = { id: string; name: string; kind: string; prepaid?: boolean | null };
type EditableTransaction = {
  id: string;
  type: "earn" | "expend";
  amount: number;
  date: string;
  time?: string | null;
  tags: { id: string }[];
  accountId: string | null;
  note: string | null;
};

type TransactionModalProps = {
  type: "earn" | "expend";
  accounts: AccountOption[];
  categories: CategoryOption[];
  trigger?: React.ReactNode;
  initialTransaction?: EditableTransaction;
  onCreate?: (data: CreateTransactionInput) => Promise<unknown>;
  onUpdate?: (data: UpdateTransactionInput) => Promise<unknown>;
  onCreateCategory: (name: string, color: string, kind: "earn" | "expend") => Promise<string>;
  onDeleteCategory?: CategorySelectProps["onDelete"];
  /** Editing a recurrence rule: no date (the schedule stays), applies to future occurrences. */
  recurring?: boolean;
  /** Editing a parcela: only tags change, applied to every parcela of the plan. */
  installment?: boolean;
};

const today = () => localDateKey();

export function TransactionModal({
  type,
  accounts,
  categories,
  trigger,
  initialTransaction,
  onCreate,
  onUpdate,
  onCreateCategory,
  onDeleteCategory,
  recurring = false,
  installment = false,
}: TransactionModalProps) {
  const [open, setOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<"earn" | "expend">(
    initialTransaction?.type ?? type
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState<RepeatInterval>("none");
  const [count, setCount] = useState("2");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(initialTransaction);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const canInstall =
    transactionType === "expend" && selectedAccount?.kind === "credit_card" && !selectedAccount.prepaid;
  useEffect(() => {
    if (repeat === "installments" && !canInstall) setRepeat("monthly");
  }, [canInstall, repeat]);

  const reset = (source = initialTransaction) => {
    setTransactionType(source?.type ?? type);
    setAmount(source?.amount ?? null);
    setDate(source?.date ?? today());
    // Postgres `time` reads back as HH:MM:SS.
    setTime(source?.time?.slice(0, 5) ?? "");
    // Earn and expend categories are separate; a tag of the other kind can't be kept.
    const sourceType = source?.type ?? type;
    setTagIds(source?.tags.map((tag) => tag.id).filter((id) =>
      categories.some((category) => category.id === id && category.kind === sourceType)) ?? []);
    setAccountId(source?.accountId ?? "");
    setNote(source?.note ?? "");
    setRepeat("none");
    setCount("2");
    setError("");
  };

  // ponytail: reset only on open, not on initialTransaction identity changes —
  // realtime refetches would otherwise stomp what you're typing
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeOpen = (nextOpen: boolean) => {
    if (isSaving) return;
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            size="icon"
            className="rounded-full"
            variant={type === "earn" ? "default" : "destructive"}
            aria-label={
              type === "earn" ? "Adicionar receita" : "Adicionar despesa"
            }
          >
            {type === "earn" ? (
              <Plus className="size-5" />
            ) : (
              <Minus className="size-5" />
            )}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {recurring
              ? "Editar recorrência"
              : isEditing
              ? "Editar transação"
              : type === "earn"
                ? "Adicionar receita"
                : "Adicionar despesa"}
          </DialogTitle>
          <DialogDescription>
            {recurring
              ? "Vale para as próximas ocorrências. As já lançadas não mudam."
              : installment
              ? "Parcela: só as etiquetas mudam, em todas as parcelas da compra."
              : isEditing
              ? "Atualize os dados desta transação."
              : `Registre ${
                  type === "earn" ? "dinheiro recebido" : "dinheiro gasto"
                } no seu painel.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (amount === null || amount <= 0) return;
            if (!accountId) {
              setError("Escolha uma conta");
              return;
            }

            setIsSaving(true);
            setError("");
            try {
              if (isEditing && initialTransaction) {
                if (!onUpdate) throw new Error("Edição indisponível");
                await onUpdate({
                  id: initialTransaction.id,
                  type: transactionType,
                  amount,
                  date,
                  time: time || undefined,
                  tag_ids: tagIds.length ? tagIds : undefined,
                  account_id: accountId,
                  note: note || undefined,
                });
              } else {
                if (!onCreate) throw new Error("Criação indisponível");
                await onCreate({
                  type,
                  amount,
                  date,
                  // Parcelas and recurrences are day-only.
                  time: repeat === "none" && time ? time : undefined,
                  tag_ids: tagIds.length ? tagIds : undefined,
                  account_id: accountId,
                  note: note || undefined,
                  paid: date <= localDateKey(),
                  recurrence:
                    repeat !== "none" && repeat !== "installments"
                      ? { interval: repeat }
                      : undefined,
                  installments:
                    repeat === "installments"
                      ? { count: Number(count) }
                      : undefined,
                });
              }
              setOpen(false);
              reset();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Não foi possível criar a transação"
              );
            } finally {
              setIsSaving(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="transaction-note">
              <Input
                id="transaction-note"
                value={note}
                maxLength={500}
                disabled={installment}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {isEditing && (
              <Field label="Tipo" htmlFor="transaction-type">
                <Select
                  value={transactionType}
                  disabled={installment}
                  onValueChange={(value) => {
                    setTransactionType(value as typeof transactionType);
                    setTagIds([]);
                  }}
                >
                  <SelectTrigger id="transaction-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expend">Despesa</SelectItem>
                    <SelectItem value="earn">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Valor (R$)" htmlFor="transaction-amount">
              <MoneyInput
                id="transaction-amount"
                value={amount}
                onValueChange={setAmount}
                required
                disabled={installment}
                autoFocus
              />
            </Field>
            {!recurring && (
              <Field label="Data" htmlFor="transaction-date">
                <DatePicker
                  id="transaction-date"
                  value={date}
                  onChange={setDate}
                  required
                  disabled={installment}
                />
              </Field>
            )}
            {!recurring && !installment && repeat === "none" && (
              <Field label="Hora (opcional)" htmlFor="transaction-time">
                <Input
                  id="transaction-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </Field>
            )}
            <Field label="Conta" htmlFor="transaction-account">
              <Select
                value={accountId}
                onValueChange={setAccountId}
                required
                disabled={installment}
              >
                <SelectTrigger id="transaction-account">
                  <SelectValue placeholder="Escolha uma conta" />
                </SelectTrigger>
                <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ·{" "}
                    {account.kind === "credit_card"
                      ? "cartão de crédito"
                      : "conta bancária"}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="space-y-2">
              <Label>{transactionType === "earn" ? "Categorias de receita" : "Categorias de despesa"}</Label>
              <CategorySelect
                categories={categories.filter((category) => category.kind === transactionType)}
                value={tagIds}
                onChange={setTagIds}
                onCreate={(name, color) => onCreateCategory(name, color, transactionType)}
                onDelete={onDeleteCategory}
              />
            </div>
            {!isEditing && (
              <Field label="Repetir" htmlFor="transaction-repeat">
                <Select
                  value={repeat}
                  onValueChange={(value) => setRepeat(value as RepeatInterval)}
                >
                  <SelectTrigger id="transaction-repeat">
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
            )}
          </div>
          {!isEditing && repeat === "installments" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Número de parcelas"
                htmlFor="transaction-installments"
              >
                <Input
                  id="transaction-installments"
                  type="number"
                  min="2"
                  max="360"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  required
                />
              </Field>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={isSaving}>
                Cancelar
              </Button>
            </DialogClose>
            <Button disabled={isSaving}>
              {isSaving
                ? isEditing
                  ? "Salvando…"
                  : "Adicionando…"
                : isEditing
                  ? "Salvar transação"
                  : "Adicionar transação"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
