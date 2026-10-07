// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportCharts } from "./ReportCharts";
import type { Category } from "#/db/schema";
import type { FaturaRow } from "#/server/faturas.core";
import type { TransactionRow } from "#/server/transactions";

afterEach(cleanup);

const category: Category = { id: "cat-1", userId: "u1", name: "Mercado", color: "#2563eb", kind: "expend" };

// The default report period is the current month, so fixtures are relative to it.
const now = new Date();
const pad = (value: number) => String(value).padStart(2, "0");
const dayThisMonth = (day: number) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;
const dayLastMonth = (day: number) => {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, day);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(day)}`;
};
function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: "t1",
    userId: "u1",
    type: "expend",
    amount: 1000,
    date: dayThisMonth(10),
    time: null,
    accountId: "a1",
    counterAccountId: null,
    externalId: null,
    usdAmount: null,
    installmentPlanId: null,
    recurrenceRuleId: null,
    periodKey: null,
    note: null,
    paid: true,
    createdAt: null,
    tags: [],
    ...overrides,
  };
}

describe("ReportCharts", () => {
  it("renders category breakdown, next fatura and committed timeline", () => {
    const transactions = [
      tx({ id: "t1", type: "expend", amount: 5000, tags: [category] }),
      tx({ id: "t2", type: "earn", amount: 9000 }),
    ];
    const faturas: FaturaRow[] = [
      {
        accountId: "acc-1",
        accountName: "Nubank",
        closingDay: 5,
        cycleKey: "2026-07-05",
        isCurrent: true,
        total: 12000,
        vencimento: "2026-08-10",
        label: "Agosto",
        status: "open",
      },
    ];

    render(
      <ReportCharts
        transactions={transactions}
        categories={[category]}
        faturas={faturas}
        showValues
      />
    );

    expect(screen.getByText("Nubank")).toBeTruthy();
    expect(screen.getByText("R$ 120,00")).toBeTruthy();
  });

  it("shows empty state when there is nothing in range", () => {
    render(
      <ReportCharts
        transactions={[]}
        categories={[]}
        faturas={[]}
        showValues
      />
    );

    expect(
      screen.getByText("Nenhuma despesa no período selecionado.")
    ).toBeTruthy();
    expect(
      screen.getByText("Nenhum cartão de crédito cadastrado.")
    ).toBeTruthy();
  });

  it("masks monetary values when privacy mode is enabled", () => {
    render(
      <ReportCharts
        transactions={[]}
        categories={[]}
        faturas={[
          {
            accountId: "acc-1",
            accountName: "Nubank",
            closingDay: 5,
            cycleKey: "2026-07-05",
            isCurrent: true,
            total: 12000,
            vencimento: "2026-08-10",
            label: "Agosto",
            status: "open",
          },
        ]}
        showValues={false}
      />
    );

    expect(screen.getAllByText("••••••").length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 120,00")).toBeNull();
  });

  it("defaults the period to the current month", () => {
    render(
      <ReportCharts
        transactions={[
          tx({ id: "t1", amount: 5000, date: dayThisMonth(10) }),
          tx({ id: "t2", amount: 9000, date: dayLastMonth(10) }),
        ]}
        categories={[]}
        faturas={[]}
        showValues
      />
    );

    expect(screen.getAllByText("R$ 50,00").length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 90,00")).toBeNull();
    expect(screen.queryByText("R$ 140,00")).toBeNull();
  });

  it("navigates whole months", () => {
    render(
      <ReportCharts
        transactions={[
          tx({ id: "t1", amount: 5000, date: dayThisMonth(10) }),
          tx({ id: "t2", amount: 9000, date: dayLastMonth(10) }),
        ]}
        categories={[]}
        faturas={[]}
        showValues
      />
    );

    fireEvent.click(screen.getByLabelText("Mês anterior"));

    expect(screen.getAllByText("R$ 90,00").length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 50,00")).toBeNull();
  });
});
