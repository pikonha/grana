import type { Account, Category, Tag, Transaction } from "#/db/schema";
import type {
  CreateTransactionInput,
  TransferInput,
  UpdateTransactionInput,
} from "#/server/schemas";
import { transferNote } from "./transaction-labels";
import { DEFAULT_TAG_COLOR } from "./tag-colors";

export const financeQueryKeys = {
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  faturas: ["faturas"] as const,
  installmentPlans: ["installmentPlans"] as const,
  recurrenceRules: ["recurrenceRules"] as const,
  transactions: ["transactions"] as const,
};

export const liveFinanceQuery = {
  refetchInterval: 2_000,
  refetchIntervalInBackground: true,
  staleTime: 1_000,
} as const;
export type TransactionRow = Transaction & { tags: Tag[] };

export function optimisticId() {
  return `optimistic-${crypto.randomUUID()}`;
}

export function optimisticTransaction(
  input: CreateTransactionInput,
  id = optimisticId(),
): TransactionRow {
  return {
    id,
    userId: "optimistic",
    type: input.type,
    amount: input.amount,
    date: input.date,
    accountId: input.account_id ?? null,
    counterAccountId: null,
    installmentPlanId: null,
    recurrenceRuleId: null,
    periodKey: null,
    note: input.note ?? null,
    createdAt: new Date(),
    tags: [],
  };
}

export function optimisticUpdatedTransaction(
  current: TransactionRow,
  input: UpdateTransactionInput,
  allTags: Tag[] = current.tags,
): TransactionRow {
  return {
    ...current,
    type: input.type,
    amount: input.amount,
    date: input.date,
    accountId: input.account_id ?? null,
    note: input.note ?? null,
    tags: input.tag_ids
      ? allTags.filter((tag) => input.tag_ids?.includes(tag.id))
      : current.tags,
  };
}

export function optimisticTransfer(
  input: TransferInput,
  id = optimisticId(),
): TransactionRow {
  return {
    ...optimisticTransaction(
      {
        type: "expend",
        amount: input.amount,
        date: input.date,
        account_id: input.account_id,
        note: transferNote(input.note),
      },
      id,
    ),
    type: "transfer",
    counterAccountId: input.counter_account_id,
  };
}

export function optimisticAccount(
  input: {
    name: string;
    kind: "credit_card" | "bank_account";
    limit?: number;
    closingDay?: number;
    dueDay?: number;
    prepaid?: boolean;
  },
  id = optimisticId(),
): Account {
  const isCreditCard = input.kind === "credit_card";
  const prepaid = isCreditCard && (input.prepaid ?? false);
  return {
    id,
    userId: "optimistic",
    name: input.name,
    kind: input.kind,
    limit: isCreditCard && !prepaid ? input.limit ?? null : null,
    closingDay: isCreditCard && !prepaid ? input.closingDay ?? null : null,
    dueDay: isCreditCard && !prepaid ? input.dueDay ?? null : null,
    prepaid,
  };
}

export function optimisticCategory(
  name: string,
  id = optimisticId(),
  color: string = DEFAULT_TAG_COLOR,
): Category {
  return { id, userId: "optimistic", name, color };
}

export function newestTransactions<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date));
}
