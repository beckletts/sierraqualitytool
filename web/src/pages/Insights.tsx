import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../lib/supabaseClient";
import { CHART_CATEGORICAL_1, CHART_INK, CHART_ORDINAL_BLUE, CHART_STATUS } from "../lib/chartPalette";
import { COMPETENCY_LABELS, COMPETENCY_LEVELS, interactionDate } from "../lib/types";
import type { Competency, Interaction } from "../lib/types";
import { AppNav } from "../components/AppNav";

const PRIORITY_META: Record<Interaction["intervention_priority"], { label: string; color: string }> = {
  hard_flag: { label: "Needs intervention", color: CHART_STATUS.critical },
  soft_flag: { label: "Review recommended", color: CHART_STATUS.warning },
  none: { label: "No flags", color: CHART_STATUS.good },
};

const TOP_TAGS_LIMIT = 8;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

// recharts' default Legend re-sorts by payload insertion order it tracks internally,
// which came out alphabetical for these stacked bars — defeating the point of an
// ordinal ramp (Training Need -> Excellent should read in that order). Render it
// ourselves in the order that actually matches the ramp.
function OrderedCompetencyLegend() {
  return (
    <ul className="chart-legend">
      {COMPETENCY_LEVELS.map((level, i) => (
        <li key={level}>
          <span className="legend-swatch" style={{ background: CHART_ORDINAL_BLUE[i] }} />
          {level}
        </li>
      ))}
    </ul>
  );
}

export function Insights() {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("interactions").select("*");
      if (error) console.error(error);
      setInteractions((data ?? []) as Interaction[]);
      setLoading(false);
    })();
  }, []);

  const volumeByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of interactions) {
      const key = dayKey(interactionDate(i));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [interactions]);

  const priorityBreakdown = useMemo(() => {
    const counts = { hard_flag: 0, soft_flag: 0, none: 0 };
    for (const i of interactions) counts[i.intervention_priority] += 1;
    return (Object.keys(counts) as Interaction["intervention_priority"][]).map((key) => ({
      key,
      label: PRIORITY_META[key].label,
      count: counts[key],
      color: PRIORITY_META[key].color,
    }));
  }, [interactions]);

  const competencyDistribution = useMemo(() => {
    return (Object.keys(COMPETENCY_LABELS) as Competency[]).map((competency) => {
      const row: Record<string, number | string> = { competency: COMPETENCY_LABELS[competency] };
      for (const level of COMPETENCY_LEVELS) row[level] = 0;
      for (const i of interactions) {
        const level = i.competency_scores?.[competency]?.level;
        if (level) row[level] = (row[level] as number) + 1;
      }
      return row;
    });
  }, [interactions]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of interactions) {
      for (const tag of i.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort(([, a], [, b]) => b - a);
    const top = sorted.slice(0, TOP_TAGS_LIMIT).map(([tag, count]) => ({ tag, count }));
    const otherCount = sorted.slice(TOP_TAGS_LIMIT).reduce((sum, [, count]) => sum + count, 0);
    return otherCount > 0 ? [...top, { tag: "Other", count: otherCount }] : top;
  }, [interactions]);

  if (loading) return <div className="page-shell">Loading...</div>;

  const untaggedNote =
    interactions.length > 0 && topTags.length === 0
      ? "No tags on any pulled interaction yet — Sierra returns tags per conversation when the agent applies them."
      : null;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Insights</h1>
        <AppNav />
      </header>

      <div className="insights-grid">
        <div className="chart-card">
          <h2>Volume over time</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={volumeByDay} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={CHART_INK.gridline} />
              <XAxis dataKey="date" tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderColor: CHART_INK.gridline, fontSize: 13 }} />
              <Bar dataKey="count" name="Interactions" fill={CHART_CATEGORICAL_1} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h2>Intervention priority</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={priorityBreakdown} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid horizontal={false} stroke={CHART_INK.gridline} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={140}
                tick={{ fill: CHART_INK.secondary, fontSize: 12 }}
                axisLine={{ stroke: CHART_INK.baseline }}
                tickLine={false}
              />
              <Tooltip contentStyle={{ borderColor: CHART_INK.gridline, fontSize: 13 }} />
              <Bar dataKey="count" name="Interactions" radius={[0, 4, 4, 0]} maxBarSize={24}>
                {priorityBreakdown.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card chart-card-wide">
          <h2>Competency levels</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={competencyDistribution} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke={CHART_INK.gridline} />
              <XAxis dataKey="competency" tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={{ stroke: CHART_INK.baseline }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderColor: CHART_INK.gridline, fontSize: 13 }} />
              <Legend content={<OrderedCompetencyLegend />} />
              {COMPETENCY_LEVELS.map((level, i) => (
                <Bar key={level} dataKey={level} stackId="levels" fill={CHART_ORDINAL_BLUE[i]} maxBarSize={48} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card chart-card-wide">
          <h2>Top conversation tags</h2>
          {untaggedNote ? (
            <p className="muted-note">{untaggedNote}</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, topTags.length * 36)}>
              <BarChart data={topTags} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid horizontal={false} stroke={CHART_INK.gridline} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_INK.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="tag"
                  width={120}
                  tick={{ fill: CHART_INK.secondary, fontSize: 12 }}
                  axisLine={{ stroke: CHART_INK.baseline }}
                  tickLine={false}
                />
                <Tooltip contentStyle={{ borderColor: CHART_INK.gridline, fontSize: 13 }} />
                <Bar dataKey="count" name="Conversations" fill={CHART_CATEGORICAL_1} radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
