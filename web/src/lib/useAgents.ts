import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { Agent } from "./types";

/**
 * Loads the Sierra agents once per mount. Includes disabled agents: they stop
 * being pulled but keep their history, so the queue still needs to label and
 * filter their existing interactions.
 */
export function useAgents(): { agents: Agent[]; loading: boolean } {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("agents").select("*").order("name");
      if (error) console.error(error);
      setAgents((data ?? []) as Agent[]);
      setLoading(false);
    })();
  }, []);

  return { agents, loading };
}

/** Agent names by id, for labelling interactions without a second lookup. */
export function agentNamesById(agents: Agent[]): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.name]));
}
