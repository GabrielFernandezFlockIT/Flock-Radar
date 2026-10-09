"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BurnUpPointView } from "../../shared/domain/stored-forecast";
import { formatDay, formatNumber } from "../../shared/ui/format";
import {
  AXIS_PROPS,
  CHART_COLORS,
  LEGEND_STYLE,
  TOOLTIP_STYLES,
} from "./chart-theme";

/**
 * Sprint burn-up: actual cumulative done, the sprint scope line, and the
 * projection cone as a shaded band between the P50 and P85 cumulative
 * series. The cone is a Recharts range `Area` (a `[low, high]` tuple per
 * point), so the gap between the two percentiles is the uncertainty.
 */

interface BurnUpDatum {
  date: string;
  label: string;
  scope: number;
  done: number | null;
  p50: number | null;
  cone: [number, number] | null;
}

function toChartData(points: readonly BurnUpPointView[]): BurnUpDatum[] {
  return points.map((point) => ({
    date: point.date,
    label: formatDay(point.date),
    scope: point.scope,
    done: point.done,
    p50: point.p50,
    cone:
      point.p50 === null || point.p85 === null
        ? null
        : [Math.min(point.p50, point.p85), Math.max(point.p50, point.p85)],
  }));
}

const SERIES_LABEL: Readonly<Record<string, string>> = {
  done: "Completado",
  scope: "Alcance",
  p50: "Proyección P50",
  cone: "Cono P50–P85",
};

export function BurnUpChart({
  points,
  unit,
}: {
  points: readonly BurnUpPointView[];
  unit: string;
}) {
  const data = toChartData(points);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" minTickGap={16} {...AXIS_PROPS} />
        <YAxis
          width={56}
          allowDecimals={false}
          label={undefined}
          {...AXIS_PROPS}
        />
        <Tooltip
          {...TOOLTIP_STYLES}
          formatter={(value: unknown, name: unknown) => {
            const label = SERIES_LABEL[String(name)] ?? String(name);
            if (Array.isArray(value)) {
              const [low, high] = value as [number, number];
              return [`${formatNumber(low, 1)} – ${formatNumber(high, 1)} ${unit}`, label];
            }
            if (typeof value !== "number") return ["—", label];
            return [`${formatNumber(value, 1)} ${unit}`, label];
          }}
        />
        <Legend wrapperStyle={LEGEND_STYLE} formatter={(name) => SERIES_LABEL[String(name)] ?? String(name)} />
        <Area
          type="monotone"
          dataKey="cone"
          name="cone"
          stroke="none"
          fill={CHART_COLORS.cone}
          fillOpacity={0.18}
          connectNulls
          isAnimationActive={false}
          activeDot={false}
        />
        <Line
          type="stepAfter"
          dataKey="scope"
          name="scope"
          stroke={CHART_COLORS.scope}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="p50"
          name="p50"
          stroke={CHART_COLORS.cone}
          strokeWidth={1.5}
          strokeDasharray="2 3"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="done"
          name="done"
          stroke={CHART_COLORS.done}
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
