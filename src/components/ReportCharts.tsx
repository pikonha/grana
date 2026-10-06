import { useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import type { Category } from "#/db/schema";
import type { TransactionRow } from "#/server/transactions";
import type { FaturaRow } from "#/server/faturas.core";
import { addMonths } from "#/lib/installments";
import { formatCentsBRL, isOpeningBalance, savingsRate } from "#/lib/money";
import { localMonthKey } from "#/lib/recurrence";
import { MonthNav } from "@/components/MonthNav";
import {
  AXIS_PROPS,
  CHART_CATEGORICAL,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS_SHORT_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];
const monthLabel = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${MONTHS_SHORT_PT[month - 1]}/${String(year).slice(2)}`;
};

const MONEY_AXIS_WIDTH = 64;
/** Slice ceiling: 6 named categories + "Outros". Past ~7 classes adjacent hues blur. */
const MAX_CATEGORY_SLICES = 6;
const OTHER_LABEL = "Outros";
const TOOLTIP_CURSOR = { fill: "var(--chart-grid)", fillOpacity: 0.5 } as const;

// ponytail: slices are colored by rank, so changing the period can repaint them.
// The legend sits beside the donut with the names, so identity never rests on
// remembering a hue — and rank order guarantees no two visible slices collide.
function sliceColor(name: string, index: number) {
  if (name === OTHER_LABEL) return CHART_OTHER;
  return CHART_CATEGORICAL[index % CHART_CATEGORICAL.length];
}

type Props = {
  transactions: TransactionRow[];
  categories: Category[];
  faturas: FaturaRow[];
  showValues: boolean;
};

export function ReportCharts({
  transactions,
  categories,
  faturas,
  showValues,
}: Props) {
  // Same month-at-a-time navigation as the transactions table.
  const [activeMonth, setActiveMonth] = useState(localMonthKey);
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

  const periodTransactions = useMemo(
    () =>
      transactions.filter(
        (t): t is TransactionRow & { type: "earn" | "expend" } =>
          t.type !== "transfer" &&
          t.date.slice(0, 7) === activeMonth &&
          !isOpeningBalance(t)
      ),
    [transactions, activeMonth]
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

  const byCategory = useMemo(() => {
    const sums = new Map<string, { value: number; color: string }>();
    for (const t of periodTransactions) {
      if (t.type !== "expend") continue;
      const tags = t.tags.length
        ? t.tags
        : [
            {
              id: "untagged",
              userId: t.userId,
              name: "Sem etiqueta",
              color: CHART_OTHER,
            },
          ];
      for (const txTag of tags) {
        const current = categoryById.get(txTag.id) ?? txTag;
        const row = sums.get(current.name) ?? {
          value: 0,
          color: current.color,
        };
        row.value += t.amount;
        sums.set(current.name, row);
      }
    }
    const ranked = [...sums.entries()]
      .map(([name, row]) => ({ name, value: row.value, color: row.color }))
      .sort((a, b) => b.value - a.value);
    if (ranked.length <= MAX_CATEGORY_SLICES) return ranked;
    const tail = ranked.slice(MAX_CATEGORY_SLICES);
    return [
      ...ranked.slice(0, MAX_CATEGORY_SLICES),
      {
        name: OTHER_LABEL,
        value: tail.reduce((sum, row) => sum + row.value, 0),
        color: CHART_OTHER,
      },
    ];
  }, [periodTransactions, categoryById]);

  const categoryTotal = byCategory.reduce((sum, row) => sum + row.value, 0);

  const byMonth = useMemo(() => {
    const sums = new Map<string, { earn: number; expend: number }>();
    for (const t of periodTransactions) {
      const key = t.date.slice(0, 7);
      const row = sums.get(key) ?? { earn: 0, expend: 0 };
      row[t.type] += t.amount;
      sums.set(key, row);
    }
    return [...sums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, row]) => ({ month: monthLabel(month), ...row }));
  }, [periodTransactions]);

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

  return (
    <div className="space-y-6">
      {/* One filter row above everything it scopes — never inside a chart card. */}
      <div className="flex flex-wrap items-center justify-center gap-4 border-2 border-foreground bg-card p-4 brutal-shadow">
        <MonthNav month={activeMonth} onChange={setActiveMonth} />
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
          {byMonth.length ? (
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
                  barGap={2}
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
                    dataKey="earn"
                    name="Receitas"
                    fill={CHART_IN}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="expend"
                    name="Despesas"
                    fill={CHART_OUT}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <Empty>Nenhuma transação no período selecionado.</Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Despesas por categoria</CardTitle>
        </CardHeader>
        <CardContent>
          {byCategory.length ? (
            <div className="grid items-center gap-6 md:grid-cols-2">
              <div className="relative">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={98}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={1}
                      // A 2px surface ring separates slices — never a border color.
                      stroke="var(--card)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {byCategory.map((row, index) => (
                        <Cell key={row.name} fill={sliceColor(row.name, index)} />
                      ))}
                    </Pie>
                    <Tooltip content={tooltip} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Total
                  </span>
                  <span className="text-lg font-bold">
                    {displayMoney(categoryTotal)}
                  </span>
                </div>
              </div>
              {/* Doubles as the table view: every slice's value is readable without hovering. */}
              <ul className="space-y-2 text-sm">
                {byCategory.map((row, index) => (
                  <li key={row.name} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 border border-foreground"
                      style={{ background: sliceColor(row.name, index) }}
                    />
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="ml-auto shrink-0 font-bold tabular-nums">
                      {displayMoney(row.value)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {categoryTotal
                        ? `${Math.round((row.value / categoryTotal) * 100)}%`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>Nenhuma despesa no período selecionado.</Empty>
          )}
        </CardContent>
      </Card>

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
                    fill={CHART_IN}
                    maxBarSize={26}
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

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}
