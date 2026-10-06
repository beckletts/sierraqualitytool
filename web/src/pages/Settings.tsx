import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import { COMPETENCY_LABELS, COMPETENCY_LEVELS } from "../lib/types";
import type { Agent, Competency, CompetencyLevel, GuidelineRow, KnowledgeSource } from "../lib/types";
import { AppNav } from "../components/AppNav";

/** Matches the worker's check in config/agents.ts — an env var name, never a token. */
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;

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

type AgentDraft = Omit<Agent, "id" | "updated_at">;

interface AgentCardProps {
  agent: Agent;
  onSave: (id: string, updates: Partial<Agent>) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
}

function AgentCard({ agent, onSave, onDelete }: AgentCardProps) {
  const [draft, setDraft] = useState<AgentDraft>({
    sierra_agent_id: agent.sierra_agent_id,
    name: agent.name,
    environment: agent.environment,
    sierra_base_url: agent.sierra_base_url,
    sierra_org_id: agent.sierra_org_id,
    token_env_var: agent.token_env_var,
    enabled: agent.enabled,
    notes: agent.notes,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  function set<K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    const problem = validateAgentDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const message = await onSave(agent.id, draft);
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2000);
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Remove "${agent.name}"? Its interactions reference it, so this only works if none have been pulled yet — otherwise disable it instead.`
      )
    ) {
      return;
    }
    setDeleting(true);
    await onDelete(agent.id);
    setDeleting(false);
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <strong>{agent.name}</strong>
        <label className="enabled-toggle">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Enabled
        </label>
      </div>

      <AgentFields draft={draft} set={set} />

      <div className="edit-actions">
        <button onClick={() => void handleSave()} disabled={saving || deleting}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button className="secondary" onClick={() => void handleDelete()} disabled={saving || deleting}>
          {deleting ? "Removing..." : "Remove agent"}
        </button>
        {savedNote && <span className="muted-note">Saved.</span>}
      </div>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

function validateAgentDraft(draft: AgentDraft): string | null {
  if (!draft.name.trim()) return "Name is required.";
  if (!draft.sierra_agent_id.trim()) return "Sierra agent ID is required.";
  if (!draft.sierra_org_id.trim()) return "Sierra org ID is required.";
  if (!draft.sierra_base_url.trim()) return "API base URL is required.";
  if (!ENV_VAR_PATTERN.test(draft.token_env_var.trim())) {
    return "Token env var must be the NAME of an environment variable — capitals, digits and underscores only (e.g. SIERRA_TOKEN_SUPPORT). Never paste the token itself here.";
  }
  return null;
}

/** Shared field set, so the edit and create cards can't drift apart. */
function AgentFields({
  draft,
  set,
}: {
  draft: AgentDraft;
  set: <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => void;
}) {
  return (
    <>
      <label className="settings-field">
        Name
        <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Qualifications support" />
        <span className="field-hint">Shown in the queue, the agent filter and the insights charts.</span>
      </label>

      <label className="settings-field">
        Sierra agent ID
        <input type="text" value={draft.sierra_agent_id} onChange={(e) => set("sierra_agent_id", e.target.value)} />
      </label>

      <label className="settings-field">
        Sierra org ID
        <input type="text" value={draft.sierra_org_id} onChange={(e) => set("sierra_org_id", e.target.value)} />
      </label>

      <label className="settings-field">
        Environment
        <input type="text" value={draft.environment} onChange={(e) => set("environment", e.target.value)} placeholder="eu" />
        <span className="field-hint">Which Sierra environment this agent lives in, e.g. eu or us. Labelling only.</span>
      </label>

      <label className="settings-field">
        API base URL
        <input
          type="text"
          value={draft.sierra_base_url}
          onChange={(e) => set("sierra_base_url", e.target.value)}
          placeholder="https://api.eu.sierra.ai"
        />
      </label>

      <label className="settings-field">
        Token env var
        <input
          type="text"
          value={draft.token_env_var}
          onChange={(e) => set("token_env_var", e.target.value)}
          placeholder="SIERRA_TOKEN_SUPPORT"
        />
        <span className="field-hint">
          The <em>name</em> of the environment variable holding this agent's Admin API token. The token itself belongs in the
          worker's environment, never in this field — everything here is readable by the whole review team.
        </span>
      </label>

      <label className="settings-field">
        Notes
        <textarea value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </label>
    </>
  );
}

interface NewAgentCardProps {
  onCreate: (agent: AgentDraft) => Promise<string | null>;
}

function NewAgentCard({ onCreate }: NewAgentCardProps) {
  const empty: AgentDraft = {
    sierra_agent_id: "",
    name: "",
    environment: "eu",
    sierra_base_url: "https://api.eu.sierra.ai",
    sierra_org_id: "",
    token_env_var: "",
    enabled: true,
    notes: null,
  };
  const [draft, setDraft] = useState<AgentDraft>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    setError(null);
    const problem = validateAgentDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const message = await onCreate(draft);
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setDraft(empty);
  }

  return (
    <div className="settings-card settings-card-new">
      <div className="settings-card-header">
        <strong>Add Sierra agent</strong>
      </div>

      <AgentFields draft={draft} set={set} />

      {error && <span className="error-text">{error}</span>}

      <div className="edit-actions">
        <button onClick={() => void handleCreate()} disabled={saving}>
          {saving ? "Adding..." : "Add agent"}
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [guidelines, setGuidelines] = useState<GuidelineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const [
      { data: agentRows, error: agentError },
      { data: sourceRows, error: sourceError },
      { data: guidelineRows, error: guidelineError },
    ] = await Promise.all([
      supabase.from("agents").select("*").order("name"),
      supabase.from("knowledge_sources").select("*").order("domain"),
      supabase.from("competency_guidelines").select("*"),
    ]);
    if (agentError) console.error(agentError);
    if (sourceError) console.error(sourceError);
    if (guidelineError) console.error(guidelineError);
    setAgents((agentRows ?? []) as Agent[]);
    setSources((sourceRows ?? []) as KnowledgeSource[]);
    setGuidelines((guidelineRows ?? []) as GuidelineRow[]);
    setLoading(false);
  }

  async function saveAgent(id: string, updates: Partial<Agent>): Promise<string | null> {
    if (!session) return "Not signed in.";
    const { error } = await supabase
      .from("agents")
      .update({ ...updates, updated_at: new Date().toISOString(), updated_by: session.user.id })
      .eq("id", id);
    if (error) {
      console.error(error);
      return error.message;
    }
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)).sort((a, b) => a.name.localeCompare(b.name)));
    return null;
  }

  async function createAgent(agent: AgentDraft): Promise<string | null> {
    if (!session) return "Not signed in.";
    const { data, error } = await supabase
      .from("agents")
      .insert({ ...agent, updated_by: session.user.id })
      .select()
      .single();
    if (error) {
      console.error(error);
      return error.message;
    }
    setAgents((prev) => [...prev, data as Agent].sort((a, b) => a.name.localeCompare(b.name)));
    return null;
  }

  async function deleteAgent(id: string) {
    const { error } = await supabase.from("agents").delete().eq("id", id);
    if (error) {
      console.error(error);
      // The foreign key from interactions is the usual cause, and disabling is
      // the right answer there — deleting would take the history with it.
      window.alert(`Could not remove agent: ${error.message}\n\nIf it has interactions, disable it instead.`);
      return;
    }
    setAgents((prev) => prev.filter((a) => a.id !== id));
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
        <h2>Sierra agents</h2>
        <p className="muted-note">
          The AI agents Overwatch reviews. Each one has its own Admin API token, which lives in the worker's environment — this
          page holds only the name of the variable to read it from, so no credential is stored here. Disabled agents are skipped
          by the worker but keep their reviewed history.
        </p>
        <div className="settings-grid">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onSave={saveAgent} onDelete={deleteAgent} />
          ))}
          <NewAgentCard onCreate={createAgent} />
        </div>
      </section>

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
