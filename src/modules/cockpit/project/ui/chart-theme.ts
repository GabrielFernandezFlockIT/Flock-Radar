/**
 * Recharts defaults are light-biased (near-black axes, white tooltips), so
 * every colour the charts use comes from a CSS variable that `globals.css`
 * redefines under `prefers-color-scheme: dark`. SVG accepts `var(--x)` in
 * `stroke` and `fill`, so the charts re-theme without a re-render.
 */
export const CHART_COLORS = {
  done: "var(--radar-done)",
  scope: "var(--radar-scope)",
  cone: "var(--radar-cone)",
  actual: "var(--radar-actual)",
  plan: "var(--radar-plan)",
  projection: "var(--radar-projection)",
  danger: "var(--radar-danger)",
  grid: "var(--radar-grid)",
  axis: "var(--radar-axis)",
} as const;

export const AXIS_PROPS = {
  stroke: CHART_COLORS.axis,
  tick: { fill: CHART_COLORS.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART_COLORS.grid },
} as const;

export const TOOLTIP_STYLES = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    color: "var(--popover-foreground)",
    fontSize: "0.75rem",
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: "0.25rem" },
  itemStyle: { color: "var(--popover-foreground)" },
  cursor: { stroke: CHART_COLORS.grid, strokeWidth: 1 },
} as const;

export const LEGEND_STYLE = {
  fontSize: "0.75rem",
  color: "var(--muted-foreground)",
} as const;
