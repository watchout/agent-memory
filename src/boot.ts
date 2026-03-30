#!/usr/bin/env node
/**
 * SessionStart hook script for agent-memory.
 * Outputs the most recent in-progress task to stdout.
 * Runs standalone (not as MCP server) — exits after output.
 */
import { createStore } from "./stores/index.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

async function boot() {
  const store = await createStore();

  try {
    const taskStates = await store.getTaskStates({
      agent_id: AGENT_ID,
      project: PROJECT,
      limit: 1,
      status: "in_progress",
    });

    const parts: string[] = [];
    parts.push(`⚡ SESSION BOOT — agent-memory (${AGENT_ID})`);
    if (PROJECT) parts.push(`Project: ${PROJECT}`);
    parts.push("");

    if (taskStates.length > 0) {
      parts.push("── CURRENT WORK ──");
      const t = taskStates[0];
      parts.push(`🔧 [${t.status}] ${t.task}`);
      if (t.progress) parts.push(`  Progress: ${t.progress}`);
      if (t.next_steps) parts.push(`  Next: ${t.next_steps}`);
      if (t.files_modified.length)
        parts.push(`  Files: ${t.files_modified.join(", ")}`);
    } else {
      parts.push("No in-progress tasks.");
    }

    parts.push("");
    parts.push("Use search_memory to find past decisions when needed.");

    // Output to stdout — hook output is injected into session context
    console.log(parts.join("\n"));
  } finally {
    await store.close();
  }
}

boot().catch((err) => {
  console.error("[agent-memory boot] Error:", err);
  process.exit(1);
});
