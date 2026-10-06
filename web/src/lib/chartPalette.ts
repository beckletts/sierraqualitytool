// Chart palette — Pearson brand.
//
// Previously this file was a blue-and-warm-grey palette carried over from a
// generic reference instance, which made Insights read as a different product
// from the rest of the app — and Insights is the page most likely to end up in
// a deck. Everything here is now Pearson Purple, Amethyst, or a tint of one of
// them over white, so no new hue enters the palette.
//
// Every value is checked against the threshold for the job it does: 4.5:1 for
// text, 3:1 for a mark or axis the reader has to perceive. Light mode only —
// the rest of the app has no dark mode yet either.

/** Text and structural ink. Tints of Pearson Purple, so chart chrome matches page chrome. */
export const CHART_INK = {
  primary: "#0D004D", // Pearson Purple — values, emphasis. 18.68:1 on white
  secondary: "#3D3371", // category labels. 10.99:1
  muted: "#564D82", // tick labels. 7.56:1 (the old #898781 was 3.50:1 — failed AA)
  gridline: "#C1BFFF", // Light Purple — recessive by design, carries no information
  baseline: "#7A739D", // axis line. 4.41:1, so the baseline is actually visible
  surface: "#FFFFFF", // .chart-card is white; the old #fcfcfb matched nothing
};

/**
 * Nominal series take Amethyst, the app's interactive colour. 9.02:1 on white.
 * A second nominal series is not defined here on purpose: no chart in Insights
 * has one, and inventing hues ahead of a need is how palettes drift.
 */
export const CHART_CATEGORICAL_1 = "#512EAB";

/**
 * Status palette — reserved for state, never reused as a series colour.
 *
 * These are the one documented exception to the brand palette: Pearson's
 * approved colours contain no red or green, and a triage queue has to read as
 * red/amber/green at a glance. The approved accents do not substitute — Amber
 * #FFCE00 is ~1.5:1 on white and fuchsia-for-bad is not a mapping anyone reads
 * instinctively.
 *
 * These values now match `--hard-flag` / `--soft-flag` / `--none-flag` in
 * index.css exactly. They previously did not (#0ca30c vs #1e8449, #fab219 vs
 * #d68910, #d03b3b vs #c0392b), so the same state wore three different colours
 * depending on which component you were looking at.
 *
 * `warning` was darkened from #D68910 so it clears 3:1 as a mark (3.45:1) while
 * still taking Pearson Purple text at 5.41:1 where it is used as a badge fill.
 * Status is never colour alone: each of these ships beside its own label.
 */
export const CHART_STATUS = {
  good: "#1E8449", // 4.72:1 on white
  warning: "#C27A0B", // 3.45:1 on white
  critical: "#C0392B", // 5.44:1 on white
};

/**
 * Ordinal ramp for the four competency levels (Training Need -> Excellent).
 * One hue, light to dark, so the reader sees the order in the colour.
 *
 * Stepped on OKLab lightness at a near-uniform 0.150 per step
 * (0.650 / 0.499 / 0.350 / 0.200), monotonic, and every step clears 3:1 against
 * the white card. The categorical validator fails a ramp like this by design —
 * it spans the lightness band on purpose — so the checks that apply are
 * monotonicity and contrast, both of which hold.
 */
export const CHART_ORDINAL = ["#9680CC", "#694AB6", "#391E8A", "#0D004D"];
