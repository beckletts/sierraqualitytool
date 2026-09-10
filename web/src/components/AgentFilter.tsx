import type { Agent } from "../lib/types";

export const ALL_AGENTS = "all";

interface AgentFilterProps {
  agents: Agent[];
  selected: string;
  onSelect: (agentId: string) => void;
}

/**
 * Agent picker for the queue and insights. Rendered only when there is more
 * than one agent — a single-agent filter is a button that does nothing.
 */
export function AgentFilter({ agents, selected, onSelect }: AgentFilterProps) {
  if (agents.length < 2) return null;

  return (
    <div className="filter-group" role="group" aria-label="Filter by agent">
      <span className="filter-group-label">Agent</span>
      <button
        className={selected === ALL_AGENTS ? "preset-active" : "preset"}
        aria-pressed={selected === ALL_AGENTS}
        onClick={() => onSelect(ALL_AGENTS)}
      >
        All
      </button>
      {agents.map((agent) => (
        <button
          key={agent.id}
          className={selected === agent.id ? "preset-active" : "preset"}
          aria-pressed={selected === agent.id}
          onClick={() => onSelect(agent.id)}
        >
          {agent.name}
        </button>
      ))}
    </div>
  );
}
