/**
 * Hook registration for the session-rotation Stop / UserPromptSubmit hook,
 * shared by the Claude Code and Codex installers (standard S3: one place).
 *
 * Registration is opt-in: an installer run without a rotation argument leaves
 * any existing rotation handler untouched; `--rotation off` removes it
 * (rollback, watcher-design.md section 9). Running an installer on a seat is
 * still an Owner decision; this file only builds the command and merges it.
 */
import { join } from "node:path";
import { ROTATION_STOP_HOOK_TIMEOUT_SECONDS } from "./session-rotation-stop.js";

export type RotationInstall = { mode: "on"; threshold_tokens?: number } | { mode: "off" };

export interface RotationHookBinding {
  agent_id: string;
  project: string;
  workspace: string;
  binding_source_ref: string;
  max_tokens: number;
  max_bytes: number;
  timeout_ms: number;
  runtime_event_manifest_path?: string;
}

export interface RotationHookGroup extends Record<string, unknown> {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
}

export const ROTATION_HOOK_STATUS_MESSAGE = "Checking context volume with Wasurezu" as const;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Ours only when the command has the exact shape built below; a lookalike (for example an echo of the id) is not. */
export function isRotationHandler(value: unknown, adapterId: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const command = (value as Record<string, unknown>).command;
  return typeof command === "string" &&
    command.includes(`session-rotation-stop.js' --adapter-id ${shellQuote(adapterId)} `);
}

/** Separates existing rotation handlers from every other handler, group by group. */
export function splitRotationHandlers<G extends RotationHookGroup>(
  groups: G[],
  adapterId: string,
): { rest: G[]; rotation: G[] } {
  const rest: G[] = [];
  const rotation: G[] = [];
  for (const group of groups) {
    const ours = group.hooks.filter((handler) => isRotationHandler(handler, adapterId));
    const others = group.hooks.filter((handler) => !isRotationHandler(handler, adapterId));
    if (others.length > 0) rest.push({ ...group, hooks: others });
    if (ours.length > 0) rotation.push({ ...group, hooks: ours });
  }
  return { rest, rotation };
}

export function buildRotationHookGroup(input: {
  runtime_root: string;
  adapter_id: string;
  binding: RotationHookBinding;
  threshold_tokens?: number;
  /** The first word of the command; the node that runs the installer when absent. */
  node_path?: string;
}): RotationHookGroup {
  const { binding } = input;
  return {
    matcher: "",
    hooks: [{
      type: "command",
      command: [
        shellQuote(input.node_path ?? process.execPath),
        shellQuote(join(input.runtime_root, "dist", "session-rotation-stop.js")),
        "--adapter-id",
        shellQuote(input.adapter_id),
        "--agent-id",
        shellQuote(binding.agent_id),
        "--project",
        shellQuote(binding.project),
        "--workspace",
        shellQuote(binding.workspace),
        "--binding-source-ref",
        shellQuote(binding.binding_source_ref),
        "--max-tokens",
        String(binding.max_tokens),
        "--max-bytes",
        String(binding.max_bytes),
        "--timeout-ms",
        String(binding.timeout_ms),
        ...(binding.runtime_event_manifest_path === undefined ? [] : [
          "--runtime-event-manifest",
          shellQuote(binding.runtime_event_manifest_path),
        ]),
        ...(input.threshold_tokens === undefined ? [] : [
          "--rotation-threshold-tokens",
          String(input.threshold_tokens),
        ]),
      ].join(" "),
      timeout: ROTATION_STOP_HOOK_TIMEOUT_SECONDS,
      statusMessage: ROTATION_HOOK_STATUS_MESSAGE,
    }],
  };
}

/** Groups to place after the other handlers: what was there, the new one, or nothing. */
export function rotationGroupsFor<G extends RotationHookGroup>(
  existing: G[],
  rotation: RotationInstall | undefined,
  build: (thresholdTokens?: number) => G,
): G[] {
  if (rotation === undefined) return existing;
  return rotation.mode === "on" ? [build(rotation.threshold_tokens)] : [];
}

/** `--rotation on|off` and `--rotation-threshold-tokens N` into one install request. */
export function resolveRotationInstall(
  flag: string | undefined,
  thresholdTokens: number | undefined,
): RotationInstall | undefined {
  if (flag !== undefined && flag !== "on" && flag !== "off") throw new Error("--rotation must be on or off");
  if (flag === "off") {
    if (thresholdTokens !== undefined) throw new Error("--rotation off cannot take --rotation-threshold-tokens");
    return { mode: "off" };
  }
  if (flag === undefined && thresholdTokens === undefined) return undefined;
  return thresholdTokens === undefined ? { mode: "on" } : { mode: "on", threshold_tokens: thresholdTokens };
}
