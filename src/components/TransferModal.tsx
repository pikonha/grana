import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { TransferInput } from "#/server/schemas";
import { DEFAULT_TRANSFER_NOTE } from "#/lib/transaction-labels";
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
  EMPTY_SELECT_VALUE,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { DatePicker, localDateKey } from "./ui/date-picker";

type AccountOption = {
  id: string;
  name: string;
};

type EditableTransfer = {
  amount: number;
  date: string;
  accountId: string | null;
  counterAccountId: string | null;
  note: string | null;
};

type TransferModalProps = {
  accounts: AccountOption[];
  onTransfer: (data: TransferInput) => Promise<unknown>;
  compact?: boolean;
  trigger?: React.ReactNode;
  /** Edit mode: prefills the form; `onTransfer` then saves the changes. */
  initialTransfer?: EditableTransfer;
};

export function TransferModal({
  accounts,
  onTransfer,
  compact = false,
  trigger,
  initialTransfer,
}: TransferModalProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDateKey);
  const [note, setNote] = useState(DEFAULT_TRANSFER_NOTE);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(initialTransfer);

  const reset = (source = initialTransfer) => {
    setFrom(source?.accountId ?? "");
    setTo(source?.counterAccountId ?? "");
    setAmount(source ? (source.amount / 100).toFixed(2) : "");
    setDate(source?.date ?? localDateKey());
    setNote(source?.note ?? DEFAULT_TRANSFER_NOTE);
    setError("");
  };

  // Reset only on open (as TransactionModal) so refetches don't stomp the form.
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
          variant="outline"
          size={compact ? "icon" : "default"}
          className={compact ? "rounded-full" : undefined}
          aria-label={compact ? "Transferir dinheiro" : undefined}
        >
          <ArrowRightLeft className={compact ? "size-5" : "size-4"} />
          {!compact && "Transferir"}
        </Button>
        )}
      </DialogTrigger>
      <DialogContent className="overflow-visible sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar transferência" : "Transferir entre contas"}
          </DialogTitle>
          <DialogDescription>
            Movimente dinheiro sem alterar seu saldo total.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const dollars = Number(amount);
            if (!dollars || dollars <= 0 || !from || !to) return;

            setIsSaving(true);
            setError("");
            try {
              await onTransfer({
                amount: Math.round(dollars * 100),
                date,
                account_id: from,
                counter_account_id: to,
                note,
              });
              setOpen(false);
              reset();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : isEditing
                    ? "Não foi possível salvar a transferência"
                    : "Não foi possível concluir a transferência"
              );
            } finally {
              setIsSaving(false);
            }
          }}
        >
          <Field label="Descrição" htmlFor="transfer-note">
            <Input
              id="transfer-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="De" htmlFor="transfer-from">
              <Select
                value={from || EMPTY_SELECT_VALUE}
                onValueChange={(value) => {
                  const accountId =
                    value === EMPTY_SELECT_VALUE ? "" : value;
                  setFrom(accountId);
                  if (to === accountId) setTo("");
                }}
                required
              >
                <SelectTrigger id="transfer-from" autoFocus>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    Selecione…
                  </SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Para" htmlFor="transfer-to">
              <Select
                value={to || EMPTY_SELECT_VALUE}
                onValueChange={(value) =>
                  setTo(value === EMPTY_SELECT_VALUE ? "" : value)
                }
                required
              >
                <SelectTrigger id="transfer-to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    Selecione…
                  </SelectItem>
                {accounts.map((account) => (
                  <SelectItem
                    key={account.id}
                    value={account.id}
                    disabled={account.id === from}
                  >
                    {account.name}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Valor (R$)" htmlFor="transfer-amount">
              <Input
                id="transfer-amount"
                type="number"
                min=".01"
                step=".01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </Field>
            <Field label="Data" htmlFor="transfer-date">
              <DatePicker
                id="transfer-date"
                value={date}
                onChange={setDate}
                required
                calendarPlacement="top"
              />
            </Field>
          </div>
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
                  : "Transferindo…"
                : isEditing
                  ? "Salvar transferência"
                  : "Transferir"}
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
