import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import { COMPETENCY_LABELS, COMPETENCY_LEVELS } from "../lib/types";
import type { Competency, CompetencyLevel, GuidelineRow, KnowledgeSource } from "../lib/types";
import { AppNav } from "../components/AppNav";

function urlsToText(urls: string[]): string {
  return urls.join("\n");
}

function textToUrls(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

interface SourceCardProps {
  source: KnowledgeSource;
  onSave: (id: string, updates: Partial<KnowledgeSource>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function SourceCard({ source, onSave, onDelete }: SourceCardProps) {
  const [baseUrl, setBaseUrl] = useState(source.base_url);
  const [template, setTemplate] = useState(source.search_url_template);
  const [seedUrlsText, setSeedUrlsText] = useState(urlsToText(source.seed_urls));
  const [enabled, setEnabled] = useState(source.enabled);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(source.id, {
      base_url: baseUrl,
      search_url_template: template,
      seed_urls: textToUrls(seedUrlsText),
      enabled,
    });
    setSaving(false);
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2000);
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${source.domain} as a knowledge source? The worker will stop checking claims against it.`)) {
      return;
    }
    setDeleting(true);
    await onDelete(source.id);
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <strong>{source.domain}</strong>
        <label className="enabled-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <label className="settings-field">
        Base URL
        <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>

      <label className="settings-field">
        Search URL template
        <input type="text" value={template} onChange={(e) => setTemplate(e.target.value)} />
        <span className="field-hint">Must contain the literal placeholder "{"{query}"}" — the worker substitutes the search terms there.</span>
      </label>

      <label className="settings-field">
        Seed URLs (one per line)
        <textarea
          value={seedUrlsText}
          onChange={(e) => setSeedUrlsText(e.target.value)}
          placeholder="https://qualifications.pearson.com/en/some-known-good-page.html"
          rows={4}
        />
        <span className="field-hint">
          Used as a fallback when the search page doesn't return anything usable. Add specific pages here as you discover which
          topics come up most.
        </span>
      </label>

      <div className="edit-actions">
        <button onClick={() => void handleSave()} disabled={saving || deleting}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button className="secondary" onClick={() => void handleDelete()} disabled={saving || deleting}>
          {deleting ? "Removing..." : "Remove source"}
        </button>
        {savedNote && <span className="muted-note">Saved.</span>}
      </div>
    </div>
  );
}

interface NewSourceCardProps {
  onCreate: (source: Omit<KnowledgeSource, "id" | "updated_at">) => Promise<string | null>;
}

function NewSourceCard({ onCreate }: NewSourceCardProps) {
  const [domain, setDomain] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [template, setTemplate] = useState("");
  const [seedUrlsText, setSeedUrlsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const trimmedDomain = domain.trim();
    if (!trimmedDomain) {
      setError("Domain is required.");
      return;
    }
    if (!template.includes("{query}")) {
      setError('Search URL template must contain the literal placeholder "{query}".');
      return;
    }
    setSaving(true);
    const errorMessage = await onCreate({
      domain: trimmedDomain,
      base_url: baseUrl.trim(),
      search_url_template: template.trim(),
      seed_urls: textToUrls(seedUrlsText),
      enabled: true,
    });
    setSaving(false);
    if (errorMessage) {
      setError(errorMessage);
      return;
    }
    setDomain("");
    setBaseUrl("");
    setTemplate("");
    setSeedUrlsText("");
  }

  return (
    <div className="settings-card settings-card-new">
      <div className="settings-card-header">
        <strong>Add knowledge source</strong>
      </div>

      <label className="settings-field">
        Domain
        <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.pearson.com" />
      </label>

      <label className="settings-field">
        Base URL
        <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.pearson.com" />
      </label>

      <label className="settings-field">
        Search URL template
        <input
          type="text"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="https://example.pearson.com/search?q={query}"
        />
        <span className="field-hint">Must contain the literal placeholder "{"{query}"}" — the worker substitutes the search terms there.</span>
      </label>

      <label className="settings-field">
        Seed URLs (one per line)
        <textarea value={seedUrlsText} onChange={(e) => setSeedUrlsText(e.target.value)} rows={3} />
        <span className="field-hint">Optional fallback pages, used when the search page doesn't return anything usable.</span>
      </label>

      {error && <span className="error-text">{error}</span>}

      <div className="edit-actions">
        <button onClick={() => void handleCreate()} disabled={saving}>
          {saving ? "Adding..." : "Add source"}
        </button>
      </div>
    </div>
  );
}

interface CompetencyCardProps {
  competency: Competency;
  rows: GuidelineRow[];
  onSave: (competency: Competency, descriptors: Record<CompetencyLevel, string>) => Promise<void>;
}

function CompetencyCard({ competency, rows, onSave }: CompetencyCardProps) {
  const initial = Object.fromEntries(COMPETENCY_LEVELS.map((level) => [level, rows.find((r) => r.level === level)?.descriptor ?? ""])) as Record<
    CompetencyLevel,
    string
  >;
  const [descriptors, setDescriptors] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(competency, descriptors);
    setSaving(false);
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2000);
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <strong>{COMPETENCY_LABELS[competency]}</strong>
      </div>
      {COMPETENCY_LEVELS.map((level) => (
        <label className="settings-field" key={level}>
          {level}
          <textarea
            value={descriptors[level]}
            onChange={(e) => setDescriptors((prev) => ({ ...prev, [level]: e.target.value }))}
            rows={2}
          />
        </label>
      ))}
      <div className="edit-actions">
        <button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        {savedNote && <span className="muted-note">Saved.</span>}
      </div>
    </div>
  );
}

export function Settings() {
  const { session } = useAuth();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [guidelines, setGuidelines] = useState<GuidelineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const [{ data: sourceRows, error: sourceError }, { data: guidelineRows, error: guidelineError }] = await Promise.all([
      supabase.from("knowledge_sources").select("*").order("domain"),
      supabase.from("competency_guidelines").select("*"),
    ]);
    if (sourceError) console.error(sourceError);
    if (guidelineError) console.error(guidelineError);
    setSources((sourceRows ?? []) as KnowledgeSource[]);
    setGuidelines((guidelineRows ?? []) as GuidelineRow[]);
    setLoading(false);
  }

  async function saveSource(id: string, updates: Partial<KnowledgeSource>) {
    if (!session) return;
    const { error } = await supabase
      .from("knowledge_sources")
      .update({ ...updates, updated_at: new Date().toISOString(), updated_by: session.user.id })
      .eq("id", id);
    if (error) {
      console.error(error);
      return;
    }
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }

  async function deleteSource(id: string) {
    const { error } = await supabase.from("knowledge_sources").delete().eq("id", id);
    if (error) {
      console.error(error);
      window.alert(`Could not remove source: ${error.message}`);
      return;
    }
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

  async function createSource(source: Omit<KnowledgeSource, "id" | "updated_at">): Promise<string | null> {
    if (!session) return "Not signed in.";
    const { data, error } = await supabase
      .from("knowledge_sources")
      .insert({ ...source, updated_by: session.user.id })
      .select()
      .single();
    if (error) {
      console.error(error);
      return error.message;
    }
    setSources((prev) => [...prev, data as KnowledgeSource].sort((a, b) => a.domain.localeCompare(b.domain)));
    return null;
  }

  async function saveGuidelines(competency: Competency, descriptors: Record<CompetencyLevel, string>) {
    if (!session) return;
    const rows = COMPETENCY_LEVELS.map((level) => ({
      competency,
      level,
      descriptor: descriptors[level],
      updated_at: new Date().toISOString(),
      updated_by: session.user.id,
    }));
    const { error } = await supabase.from("competency_guidelines").upsert(rows, { onConflict: "competency,level" });
    if (error) {
      console.error(error);
      return;
    }
    setGuidelines((prev) => [...prev.filter((r) => r.competency !== competency), ...rows]);
  }

  if (loading) return <div className="page-shell">Loading...</div>;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Settings</h1>
        <AppNav />
      </header>

      <section>
        <h2>Knowledge sources</h2>
        <p className="muted-note">
          The verified sources the worker checks agent claims against. Add or remove domains as needed, and edit the search
          pattern and seed URLs to improve fetch reliability. Disabled sources are skipped by the worker but kept here in case
          you want them back.
        </p>
        <div className="settings-grid">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} onSave={saveSource} onDelete={deleteSource} />
          ))}
          <NewSourceCard onCreate={createSource} />
        </div>
      </section>

      <section>
        <h2>Competency guidelines</h2>
        <p className="muted-note">The rubric text the worker scores transcripts against, per competency and level.</p>
        <div className="settings-grid">
          {(Object.keys(COMPETENCY_LABELS) as Competency[]).map((competency) => (
            <CompetencyCard
              key={competency}
              competency={competency}
              rows={guidelines.filter((g) => g.competency === competency)}
              onSave={saveGuidelines}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
