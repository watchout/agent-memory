/**
 * CELL-4MCP-KUSABI-001 — agent memory partition resolver.
 *
 * Lane 3 (Kusabi) of SPEC-4MCP-002. Dispatch anchor:
 *   https://github.com/watchout/agent-memory/issues/247
 *
 * FROZEN BOUNDARY (verbatim from the lane pack):
 *   "partition/visibility NEVER inferred from shared identity metadata —
 *    only from own table."
 *
 * This module is the single sanctioned entry point for resolving an
 * agent's partition + visibility. It reads EXCLUSIVELY from the own
 * `kusabi_agent_memory_partitions` table (via the Store port). Absence of
 * an own-table row fails CLOSED — the resolver returns the most
 * restrictive visibility and NO inferred partition. It never consults any
 * shared identity metadata a caller may hold, even when that metadata is
 * passed in (it is accepted only so callers can observe it is ignored).
 */
import type { Store, PartitionVisibility } from "./stores/types.js";

/** Fail-closed default when no own-table row exists: most restrictive. */
export const FAIL_CLOSED_VISIBILITY: PartitionVisibility = "private";

export interface ResolvePartitionInput {
  /** Immutable, only identity key. */
  agent_id: string;
  memory_project: string;
  /**
   * Shared identity metadata a caller may hold (e.g. a peer MCP's
   * identity/profile blob). ACCEPTED BUT NEVER READ. Partition and
   * visibility are resolved solely from the own table; this field exists
   * only so the fail-closed boundary can be demonstrated (negative
   * fixture). Do NOT add a code path that reads it.
   */
  identity_metadata?: Record<string, unknown>;
}

export interface PartitionResolution {
  agent_id: string;
  /** Non-null only when resolved from the own table. */
  memory_project: string | null;
  /** Non-null only when resolved from the own table. */
  partition_key: string | null;
  visibility: PartitionVisibility;
  /** true iff an own-table row was found; false = fail-closed. */
  resolved: boolean;
  /** Provenance of the resolution — always the own table or fail-closed. */
  source: "own_table" | "fail_closed";
}

/**
 * Resolve an agent's partition + visibility from the own table ONLY.
 *
 * @returns own-table values when a row exists; otherwise a fail-closed
 *          resolution (`visibility: "private"`, no partition inferred).
 */
export async function resolvePartition(
  store: Store,
  input: ResolvePartitionInput
): Promise<PartitionResolution> {
  // Own table is the sole source of truth. `input.identity_metadata` is
  // intentionally not referenced anywhere in this function.
  const row = await store.getKusabiPartition({
    agent_id: input.agent_id,
    memory_project: input.memory_project,
  });

  if (!row) {
    return {
      agent_id: input.agent_id,
      memory_project: null,
      partition_key: null,
      visibility: FAIL_CLOSED_VISIBILITY,
      resolved: false,
      source: "fail_closed",
    };
  }

  return {
    agent_id: row.agent_id,
    memory_project: row.memory_project,
    partition_key: row.partition_key,
    visibility: row.default_visibility,
    resolved: true,
    source: "own_table",
  };
}
