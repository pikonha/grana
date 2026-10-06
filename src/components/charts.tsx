// Shared chart chrome: recessive axes/grid, brutalist tooltip, hand-rolled legend.
// ponytail: recharts' default Legend/Tooltip DOM can't be themed — these two
// small components replace both instead of fighting their inline styles.

export const CHART_IN = "var(--chart-in)";
export const CHART_OUT = "var(--chart-out)";

/** Fixed slot order — never cycled past the last slot; the tail folds into OTHER. */
export const CHART_CATEGORICAL = [
  "var(--chart-c1)",
  "var(--chart-c2)",
  "var(--chart-c3)",
  "var(--chart-c4)",
  "var(--chart-c5)",
  "var(--chart-c6)",
] as const;
export const CHART_OTHER = "var(--chart-other)";

export const GRID_PROPS = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "0",
  vertical: false,
} as const;

export const AXIS_TICK = {
  fill: "var(--chart-label)",
  fontSize: 11,
  fontWeight: 600,
} as const;

export const AXIS_PROPS = {
  stroke: "var(--chart-axis)",
  tick: AXIS_TICK,
  tickLine: false,
} as const;

export const HIDDEN_MONEY = "••••••";

/** Compact axis ticks (R$ 1,2 mil) so the axis doesn't eat a phone screen. */
export const axisMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  });

type TooltipRow = {
  name?: unknown;
  value?: unknown;
  /** Bars expose `color`; pie slices only expose the cell `fill`. */
  color?: string;
  fill?: string;
};

export function ChartTooltip({
  label,
  payload,
  format,
}: {
  label?: unknown;
  payload?: readonly TooltipRow[];
  format: (cents: number) => string;
}) {
  if (!payload?.length) return null;
  return (
    <div className="border-2 border-foreground bg-popover px-3 py-2 text-xs text-popover-foreground brutal-shadow">
      {label != null && label !== "" && (
        <p className="mb-1.5 font-bold uppercase tracking-wide">
          {String(label)}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((row, index) => (
          <p key={index} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 border border-foreground"
              style={{ background: row.color ?? row.fill }}
            />
            <span className="text-muted-foreground">{String(row.name ?? "")}</span>
            <span className="ml-auto pl-3 font-bold tabular-nums">
              {format(Number(row.value ?? 0))}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

/** A headline number is a stat tile, never a one-bar chart. */
export function StatTile({
  label,
  value,
  negative,
  hint,
}: {
  label: string;
  value: string;
  negative?: boolean;
  hint?: string;
}) {
  return (
    <div className="border-2 border-foreground bg-card p-4 brutal-shadow">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold sm:text-2xl ${
          negative ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      {hint && (
        <p
          className={`mt-1 text-sm font-bold ${
            negative ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function ChartLegend({
  items,
}: {
  items: readonly { label: string; color: string }[];
}) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 border border-foreground"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
