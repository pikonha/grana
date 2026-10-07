import { describe, expect, it } from "vitest";
import {
  newestTransactions,
  optimisticAccount,
  optimisticCategory,
  optimisticTransaction,
  optimisticTransfer,
} from "./optimistic";

describe("optimistic finance rows", () => {
  it("builds a transaction in the server row shape", () => {
    const row = optimisticTransaction(
      {
        type: "expend",
        amount: 1234,
        date: "2026-07-27",
        account_id: "account",
        tag_ids: ["category"],
        note: "Lunch",
      },
      "temporary",
    );

    expect(row).toMatchObject({
      id: "temporary",
      type: "expend",
      amount: 1234,
      accountId: "account",
      note: "Lunch",
      tags: [],
    });
  });

  it("builds a transfer with both accounts", () => {
    const row = optimisticTransfer(
      {
        amount: 500,
        date: "2026-07-27",
        account_id: "from",
        counter_account_id: "to",
        note: "Transferência",
      },
      "temporary",
    );

    expect(row).toMatchObject({
      type: "transfer",
      accountId: "from",
      counterAccountId: "to",
      note: "Transferência",
    });
  });

  it("normalizes account and category rows", () => {
    expect(
      optimisticAccount(
        { name: "Card", kind: "credit_card", prepaid: true, limit: 1000 },
        "account",
      ),
    ).toMatchObject({ id: "account", prepaid: true, limit: null });
    expect(optimisticCategory("Food", "category")).toEqual({
      id: "category",
      userId: "optimistic",
      name: "Food",
      color: "#2563eb",
      kind: "expend",
    });
  });

  it("keeps newest transactions first", () => {
    const old = optimisticTransaction(
      { type: "earn", amount: 1, date: "2026-06-01", account_id: "a" },
      "old",
    );
    const recent = optimisticTransaction(
      { type: "earn", amount: 1, date: "2026-07-01", account_id: "a" },
      "recent",
    );

    expect(newestTransactions([old, recent]).map((row) => row.id)).toEqual([
      "recent",
      "old",
    ]);
  });
});
