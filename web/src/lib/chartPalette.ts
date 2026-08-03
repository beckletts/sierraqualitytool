// Validated default palette (light mode only — the rest of this app has no dark
// mode yet either). See the dataviz skill's references/palette.md for the source
// and the CVD/contrast validation this passed.

export const CHART_INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
  surface: "#fcfcfb",
};

export const CHART_CATEGORICAL_1 = "#2a78d6"; // blue — the single-hue default for one-series charts

// Status palette (fixed — reserved for state, never reused as a generic series color).
// Matches the badge colors already used elsewhere in this app for the same statuses.
export const CHART_STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
};

// Sequential blue, ordinal steps — for the 4 ordered competency levels
// (Training Need -> Excellent). Light surface: no lighter than step 250.
export const CHART_ORDINAL_BLUE = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"];
