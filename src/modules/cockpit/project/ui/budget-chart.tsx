"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BudgetSeriesPointView } from "../../shared/domain/stored-forecast";
import { formatDay, formatMoney } from "../../shared/ui/format";
import {
  AXIS_PROPS,
  CHART_COLORS,
  LEGEND_STYLE,
  TOOLTIP_STYLES,
} from "./chart-theme";

/**
 * Budget burn: actual cumulative spend against the linear plan, continued by
 * the EWMA projection. The budget ceiling and the projected exhaustion day
 * are reference lines, so "when does the money run out" is readable without
 * the tooltip.
 */

interface BudgetDatum {
  label: string;
  actual: number | null;
  plan: number;
  projected: number | null;
}

const SERIES_LABEL: Readonly<Record<string, string>> = {
  actual: "Gasto real",
  plan: "Plan",
  projected: "Proyección",
};

export function BudgetChart({
  series,
  currency,
  budget,
  exhaustionDate,
}: {
  series: readonly BudgetSeriesPointView[];
  currency: string;
  budget: number;
  exhaustionDate: string | null;
}) {
  const data: BudgetDatum[] = series.map((point) => ({
    label: formatDay(point.date),
    actual: point.actual,
    plan: point.plan,
    projected: point.projected,
  }));

  const exhaustionLabel = exhaustionDate === null ? null : formatDay(exhaustionDate);
  const hasExhaustionTick =
    exhaustionLabel !== null && data.some((point) => point.label === exhaustionLabel);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" minTickGap={16} {...AXIS_PROPS} />
        <YAxis
          width={72}
          tickFormatter={(value: number) => formatMoney(value, currency)}
          {...AXIS_PROPS}
        />
        <Tooltip
          {...TOOLTIP_STYLES}
          formatter={(value: unknown, name: unknown) => {
            const label = SERIES_LABEL[String(name)] ?? String(name);
            if (typeof value !== "number") return ["—", label];
            return [formatMoney(value, currency), label];
          }}
        />
        <Legend
          wrapperStyle={LEGEND_STYLE}
          formatter={(name) => SERIES_LABEL[String(name)] ?? String(name)}
        />
        {budget > 0 ? (
          <ReferenceLine
            y={budget}
            stroke={CHART_COLORS.danger}
            strokeDasharray="6 4"
            label={{
              value: `Presupuesto ${formatMoney(budget, currency)}`,
              position: "insideTopRight",
              fill: CHART_COLORS.danger,
              fontSize: 11,
            }}
          />
        ) : null}
        {hasExhaustionTick ? (
          <ReferenceLine
            x={exhaustionLabel ?? undefined}
            stroke={CHART_COLORS.danger}
            strokeDasharray="4 4"
            label={{
              value: "Agotado",
              position: "insideBottomLeft",
              fill: CHART_COLORS.danger,
              fontSize: 11,
            }}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="plan"
          name="plan"
          stroke={CHART_COLORS.plan}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          name="projected"
          stroke={CHART_COLORS.projection}
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="actual"
          name="actual"
          stroke={CHART_COLORS.actual}
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
