import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Account, Category } from "#/db/schema";
import type { TransactionRow } from "#/server/transactions";
import type { FaturaRow } from "#/server/faturas.core";
import { addMonths } from "#/lib/installments";
import { formatCentsBRL, isOpeningBalance, savingsRate } from "#/lib/money";
import { localMonthKey, shiftMonth } from "#/lib/recurrence";
import { MonthNav } from "@/components/MonthNav";
import {
  AXIS_PROPS,
  BAR_PROPS,
  CHART_COMMITTED,
  CHART_IN,
  CHART_OTHER,
  CHART_OUT,
  ChartLegend,
  ChartTooltip,
  GRID_PROPS,
  HIDDEN_MONEY,
  StatTile,
  axisMoney,
} from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS_SHORT_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];
const monthLabel = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${MONTHS_SHORT_PT[month - 1]}/${String(year).slice(2)}`;
};

const MONEY_AXIS_WIDTH = 64;
/** Slice ceiling: 6 named categories + "Outros". Past ~7 slices a donut stops reading. */
const MAX_CATEGORY_SLICES = 6;
const OTHER_LABEL = "Outros";
const TOOLTIP_CURSOR = { fill: "var(--chart-grid)", fillOpacity: 0.5 } as const;
/** Months in the period, ending at the month MonthNav shows. */
const SPANS = [1, 3, 6, 12] as const;
type Span = (typeof SPANS)[number];
const spanLabel = (span: Span) => (span === 1 ? "Mês" : `${span} meses`);
const monthsEnding = (end: string, span: number) =>
  Array.from({ length: span }, (_, i) => shiftMonth(end, i - (span - 1)));

type PeriodTransaction = TransactionRow & { type: "earn" | "expend" };
type CategoryRow = {
  name: string;
  color: string;
  value: number;
  previous: number;
  transactions: PeriodTransaction[];
};

const UNTAGGED = { id: "untagged", name: "Sem etiqueta", color: CHART_OTHER };

/** One row per category of `kind`; a transaction with two tags counts in both. */
function sumByCategory(
  rows: PeriodTransaction[],
  kind: "earn" | "expend",
  categoryById: Map<string, Category>
) {
  const sums = new Map<string, Omit<CategoryRow, "previous">>();
  for (const t of rows) {
    if (t.type !== kind) continue;
    for (const txTag of t.tags.length ? t.tags : [UNTAGGED]) {
      const current = categoryById.get(txTag.id) ?? txTag;
      const row = sums.get(current.name) ?? {
        name: current.name,
        color: current.color,
        value: 0,
        transactions: [],
      };
      row.value += t.amount;
      row.transactions.push(t);
      sums.set(current.name, row);
    }
  }
  return sums;
}

const inMonths = (transactions: TransactionRow[], keys: string[]) => {
  const set = new Set(keys);
  return transactions.filter(
    (t): t is PeriodTransaction =>
      t.type !== "transfer" && set.has(t.date.slice(0, 7)) && !isOpeningBalance(t)
  );
};

/** Ranked by value, with the same category's total in the previous period for the delta. */
function rankCategories(
  current: PeriodTransaction[],
  previous: PeriodTransaction[],
  kind: "earn" | "expend",
  categoryById: Map<string, Category>
): CategoryRow[] {
  const before = sumByCategory(previous, kind, categoryById);
  return [...sumByCategory(current, kind, categoryById).values()]
    .map((row) => ({ ...row, previous: before.get(row.name)?.value ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

type Props = {
  transactions: TransactionRow[];
  categories: Category[];
  faturas: FaturaRow[];
  accounts?: Account[];
  showValues: boolean;
};

export function ReportCharts({
  transactions,
  categories,
  faturas,
  accounts = [],
  showValues,
}: Props) {
  // Same month-at-a-time navigation as the transactions table, plus how many
  // months back from it the period covers.
  const [activeMonth, setActiveMonth] = useState(localMonthKey);
  const [span, setSpan] = useState<Span>(1);
  const displayMoney = (cents: number) =>
    showValues ? formatCentsBRL(cents) : HIDDEN_MONEY;
  const displayAxisMoney = (cents: number) =>
    showValues ? axisMoney(cents) : HIDDEN_MONEY;
  const tooltip = (props: { label?: unknown; payload?: readonly unknown[] }) => (
    <ChartTooltip
      label={props.label}
      payload={props.payload as never}
      format={displayMoney}
    />
  );

  const months = useMemo(() => monthsEnding(activeMonth, span), [activeMonth, span]);
  const previousMonths = useMemo(
    () => monthsEnding(shiftMonth(activeMonth, -span), span),
    [activeMonth, span]
  );

  const periodTransactions = useMemo(
    () => inMonths(transactions, months),
    [transactions, months]
  );
  const previousTransactions = useMemo(
    () => inMonths(transactions, previousMonths),
    [transactions, previousMonths]
  );

  const totals = useMemo(() => {
    let earn = 0;
    let expend = 0;
    for (const t of periodTransactions) {
      if (t.type === "earn") earn += t.amount;
      else expend += t.amount;
    }
    return { earn, expend, net: earn - expend, rate: savingsRate(earn, expend) };
  }, [periodTransactions]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const accountName = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a.name]));
    return (id: string) => byId.get(id) ?? "";
  }, [accounts]);

  const expendByCategory = useMemo(
    () => rankCategories(periodTransactions, previousTransactions, "expend", categoryById),
    [periodTransactions, previousTransactions, categoryById]
  );
  const earnByCategory = useMemo(
    () => rankCategories(periodTransactions, previousTransactions, "earn", categoryById),
    [periodTransactions, previousTransactions, categoryById]
  );

  // Every month of the period gets a bar, even an empty one, so the axis reads as a timeline.
  const byMonth = useMemo(() => {
    const sums = new Map(months.map((m) => [m, { earn: 0, expend: 0 }]));
    for (const t of periodTransactions) sums.get(t.date.slice(0, 7))![t.type] += t.amount;
    return months.map((month) => ({ month: monthLabel(month), ...sums.get(month)! }));
  }, [periodTransactions, months]);

  const nextFaturaPerCard = useMemo(
    () => faturas.filter((f) => f.isCurrent),
    [faturas]
  );

  const committedTimeline = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = addMonths(today, 6);
    const sums = new Map<string, number>();
    for (const f of faturas) {
      if (f.vencimento < today || f.vencimento > horizon) continue;
      const key = f.vencimento.slice(0, 7);
      sums.set(key, (sums.get(key) ?? 0) + f.total);
    }
    return [...sums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month: monthLabel(month), total }));
  }, [faturas]);

  const previousLabel = span === 1 ? "mês anterior" : "período anterior";

  return (
    <div className="space-y-6">
      {/* One filter row above everything it scopes — never inside a chart card. */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-2 border-foreground bg-card p-4 brutal-shadow">
        <div className="flex items-center">
          <MonthNav month={activeMonth} onChange={setActiveMonth} />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período">
          {SPANS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === span ? "default" : "outline"}
              aria-pressed={option === span}
              onClick={() => setSpan(option)}
            >
              {spanLabel(option)}
            </Button>
          ))}
          {span > 1 && (
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {monthLabel(months[0])} – {monthLabel(activeMonth)}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Receitas no período" value={displayMoney(totals.earn)} />
        <StatTile label="Despesas no período" value={displayMoney(totals.expend)} />
        <StatTile
          label="Resultado"
          value={displayMoney(totals.net)}
          negative={totals.net < 0}
          hint={
            totals.rate === null
              ? "sem receita no período"
              : `${totals.rate > 0 ? "+" : ""}${Math.round(totals.rate * 100)}% da receita`
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receitas x despesas por mês</CardTitle>
        </CardHeader>
        <CardContent>
          {periodTransactions.length ? (
            <>
              <ChartLegend
                items={[
                  { label: "Receitas", color: CHART_IN },
                  { label: "Despesas", color: CHART_OUT },
                ]}
              />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={byMonth}
                  barGap={4}
                  barCategoryGap="30%"
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis
                    {...AXIS_PROPS}
                    axisLine={false}
                    tickFormatter={displayAxisMoney}
                    width={MONEY_AXIS_WIDTH}
                  />
                  <Tooltip cursor={TOOLTIP_CURSOR} content={tooltip} />
                  <Bar dataKey="earn" name="Receitas" fill={CHART_IN} {...BAR_PROPS} />
                  <Bar dataKey="expend" name="Despesas" fill={CHART_OUT} {...BAR_PROPS} />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <Empty>Nenhuma transação no período selecionado.</Empty>
          )}
        </CardContent>
      </Card>

      <CategoryDonut
        rows={expendByCategory}
        earn={totals.earn}
        previousLabel={previousLabel}
        displayMoney={displayMoney}
        accountName={accountName}
      />

      <CategoryBreakdown
        title="Receitas por categoria"
        rows={earnByCategory}
        previousLabel={previousLabel}
        displayMoney={displayMoney}
        accountName={accountName}
        empty="Nenhuma receita no período selecionado."
      />

      <Card>
        <CardHeader>
          <CardTitle>Cartões de crédito — próximos 6 meses</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Fatura atual por cartão
            </p>
            {nextFaturaPerCard.length ? (
              <div className="space-y-2">
                {nextFaturaPerCard.map((f) => (
                  <div
                    key={f.accountId}
                    className="flex justify-between gap-3 border-b pb-2 last:border-0"
                  >
                    <span className="min-w-0 truncate">{f.accountName}</span>
                    <span className="shrink-0 font-bold tabular-nums">
                      {displayMoney(f.total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Nenhum cartão de crédito cadastrado.</Empty>
            )}
          </div>
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Total comprometido por vencimento
            </p>
            {committedTimeline.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={committedTimeline}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis
                    {...AXIS_PROPS}
                    axisLine={false}
                    tickFormatter={displayAxisMoney}
                    width={MONEY_AXIS_WIDTH}
                  />
                  <Tooltip cursor={TOOLTIP_CURSOR} content={tooltip} />
                  <Bar
                    dataKey="total"
                    name="Comprometido"
                    fill={CHART_COMMITTED}
                    {...BAR_PROPS}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty>Nenhum compromisso nos próximos 6 meses.</Empty>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Top slices by value; the tail folds into one "Outros" slice that still opens to its rows. */
function foldSlices(rows: CategoryRow[]): CategoryRow[] {
  if (rows.length <= MAX_CATEGORY_SLICES + 1) return rows;
  const tail = rows.slice(MAX_CATEGORY_SLICES);
  return [
    ...rows.slice(0, MAX_CATEGORY_SLICES),
    {
      name: OTHER_LABEL,
      color: CHART_OTHER,
      value: tail.reduce((sum, row) => sum + row.value, 0),
      previous: tail.reduce((sum, row) => sum + row.previous, 0),
      transactions: tail.flatMap((row) => row.transactions),
    },
  ];
}

const deltaLabel = (row: { value: number; previous: number }, previousLabel: string) => {
  if (!row.previous) return `novo vs. ${previousLabel}`;
  const pct = Math.round(((row.value - row.previous) / row.previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% vs. ${previousLabel}`;
};
const share = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";

/** Hover card for a slice: how big it is, how it moved, and how much of the income it eats. */
export function CategoryTooltip({
  row,
  total,
  earn,
  previousLabel,
  displayMoney,
}: {
  row: CategoryRow;
  total: number;
  earn: number;
  previousLabel: string;
  displayMoney: (cents: number) => string;
}) {
  return (
    <div className="border-2 border-foreground bg-popover px-3 py-2 text-xs text-popover-foreground brutal-shadow">
      <p className="mb-1.5 flex items-center gap-2 font-bold uppercase tracking-wide">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 border border-foreground"
          style={{ background: row.color }}
        />
        {row.name}
      </p>
      <div className="space-y-1">
        <p className="flex justify-between gap-4">
          <span className="text-muted-foreground">{row.transactions.length} lanç.</span>
          <span className="font-bold tabular-nums">{displayMoney(row.value)}</span>
        </p>
        <p className="flex justify-between gap-4">
          <span className="text-muted-foreground">das despesas</span>
          <span className="font-bold tabular-nums">{share(row.value, total)}</span>
        </p>
        <p className="flex justify-between gap-4">
          <span className="text-muted-foreground">da receita</span>
          <span className="font-bold tabular-nums">
            {earn ? share(row.value, earn) : "sem receita"}
          </span>
        </p>
        <p className="flex justify-between gap-4 border-t border-border pt-1">
          <span className="text-muted-foreground">{deltaLabel(row, previousLabel)}</span>
          <span className="tabular-nums text-muted-foreground">
            {row.previous ? displayMoney(row.previous) : ""}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Expense donut: slices wear their tag color with a hard 2px outline; the legend
 * beside it is the table view and shares the click. A slice (or its legend row)
 * opens the transactions behind it under the chart.
 */
function CategoryDonut({
  rows,
  earn,
  previousLabel,
  displayMoney,
  accountName,
}: {
  rows: CategoryRow[];
  earn: number;
  previousLabel: string;
  displayMoney: (cents: number) => string;
  accountName: (id: string) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const slices = useMemo(() => foldSlices(rows), [rows]);
  const total = slices.reduce((sum, row) => sum + row.value, 0);
  const openRow = slices.find((row) => row.name === open) ?? null;
  const toggle = (name: string) => setOpen((current) => (current === name ? null : name));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
        <CardTitle>Despesas por categoria</CardTitle>
        {slices.length > 0 && (
          <span className="text-sm font-bold tabular-nums">{displayMoney(total)}</span>
        )}
      </CardHeader>
      <CardContent>
        {slices.length ? (
          <>
            <div className="grid items-center gap-6 md:grid-cols-2">
              <div className="relative [&_.recharts-sector]:cursor-pointer [&_.recharts-sector]:outline-none">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={100}
                      startAngle={90}
                      endAngle={-270}
                      stroke="var(--foreground)"
                      strokeWidth={2}
                      isAnimationActive={false}
                      onClick={(_, index) => toggle(slices[index].name)}
                    >
                      {slices.map((row) => (
                        <Cell
                          key={row.name}
                          fill={row.color}
                          fillOpacity={open && open !== row.name ? 0.35 : 1}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      // Above the centre label, which is an absolutely positioned sibling.
                      wrapperStyle={{ zIndex: 10 }}
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as CategoryRow | undefined;
                        return row ? (
                          <CategoryTooltip
                            row={row}
                            total={total}
                            earn={earn}
                            previousLabel={previousLabel}
                            displayMoney={displayMoney}
                          />
                        ) : null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {openRow ? openRow.name : "Total"}
                  </span>
                  <span className="text-lg font-bold tabular-nums">
                    {displayMoney(openRow ? openRow.value : total)}
                  </span>
                  {openRow && (
                    <span className="text-xs font-bold text-muted-foreground">
                      {share(openRow.value, total)} das despesas
                    </span>
                  )}
                </div>
              </div>
              {/* Doubles as the table view: every slice's value is readable without hovering. */}
              <ul className="space-y-1 text-sm">
                {slices.map((row) => {
                  const isOpen = open === row.name;
                  return (
                    <li key={row.name}>
                      <button
                        type="button"
                        aria-pressed={isOpen}
                        onClick={() => toggle(row.name)}
                        className={`flex w-full cursor-pointer items-center gap-2 border-2 px-2 py-1 text-left ${
                          isOpen
                            ? "border-foreground bg-primary brutal-shadow"
                            : "border-transparent hover:bg-muted"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 border border-foreground"
                          style={{ background: row.color }}
                        />
                        <span className="min-w-0 truncate font-bold">{row.name}</span>
                        <span className="ml-auto shrink-0 font-bold tabular-nums">
                          {displayMoney(row.value)}
                        </span>
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {share(row.value, total)}
                        </span>
                      </button>
                    </li>
                  );
                })}
                <li className="px-2 pt-1 text-xs text-muted-foreground">
                  Clique numa fatia para ver os lançamentos. Passe o mouse para comparar
                  com o {previousLabel} e com a receita.
                </li>
              </ul>
            </div>
            {openRow && (
              <TransactionList
                rows={openRow.transactions}
                displayMoney={displayMoney}
                accountName={accountName}
                className="mt-4"
              />
            )}
          </>
        ) : (
          <Empty>Nenhuma despesa no período selecionado.</Empty>
        )}
      </CardContent>
    </Card>
  );
}

/** The transactions behind a category, largest first. */
function TransactionList({
  rows,
  displayMoney,
  accountName,
  className = "",
}: {
  rows: PeriodTransaction[];
  displayMoney: (cents: number) => string;
  accountName: (id: string) => string;
  className?: string;
}) {
  return (
    <ul
      className={`divide-y divide-border border-2 border-foreground bg-background text-xs ${className}`}
    >
      {[...rows]
        .sort((a, b) => b.amount - a.amount)
        .map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {t.date.slice(8, 10)}/{t.date.slice(5, 7)}
            </span>
            <span className="min-w-0 truncate">{t.note || "—"}</span>
            <span className="hidden shrink-0 text-muted-foreground sm:inline">
              {accountName(t.accountId)}
            </span>
            <span className="ml-auto shrink-0 font-bold tabular-nums">
              {displayMoney(t.amount)}
            </span>
          </li>
        ))}
    </ul>
  );
}

/**
 * Ranked category bars that double as the table view; a row opens to the
 * transactions behind it. ponytail: plain divs like the dashboard's
 * AccountBars — a ranked list never needs a chart lib.
 */
function CategoryBreakdown({
  title,
  rows,
  previousLabel,
  displayMoney,
  accountName,
  empty,
}: {
  title: string;
  rows: CategoryRow[];
  previousLabel: string;
  displayMoney: (cents: number) => string;
  accountName: (id: string) => string;
  empty: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = rows[0]?.value ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {rows.length > 0 && (
          <span className="text-sm font-bold tabular-nums">{displayMoney(total)}</span>
        )}
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ul className="space-y-3 text-sm">
            {rows.map((row) => {
              const isOpen = open === row.name;
              return (
                <li key={row.name}>
                  <button
                    type="button"
                    className="block w-full cursor-pointer text-left"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : row.name)}
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 truncate font-bold">{row.name}</span>
                      <span className="ml-auto shrink-0 font-bold tabular-nums">
                        {displayMoney(row.value)}
                      </span>
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {share(row.value, total)}
                      </span>
                    </div>
                    <div className="mt-1.5 ml-6 flex items-center gap-3">
                      <div
                        className="h-4 shrink-0 border-2 border-foreground"
                        style={{
                          width: `${max ? Math.max((row.value / max) * 50, 1) : 0}%`,
                          background: row.color,
                        }}
                      />
                      <span className="truncate text-xs text-muted-foreground">
                        {row.transactions.length} lanç. · {deltaLabel(row, previousLabel)}
                      </span>
                    </div>
                  </button>
                  {isOpen && (
                    <TransactionList
                      rows={row.transactions}
                      displayMoney={displayMoney}
                      accountName={accountName}
                      className="mt-2 ml-6"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{empty}</Empty>
        )}
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}
