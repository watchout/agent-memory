/**
 * Shared contract constants for agent-comms ↔ wasurezu integration.
 *
 * These values must stay in sync with the agent-comms-mcp server.
 * When agent-comms renames a tool or field, update this file and the
 * anti-regression test will catch any stale references in wasurezu code.
 *
 * History:
 *   - PR#64/PR#73 incident: post-tool-hook matched `mcp__agent-comms__reply`
 *     and `text` field after agent-comms renamed them to `send` / `content`
 *     (agent-comms PR#117). Added this contract to prevent silent no-ops.
 */

/** The current MCP tool name for sending messages via agent-comms. */
export const AGENT_COMMS_SEND_TOOL = "mcp__agent-comms__send";

/**
 * Field name in agent-comms `send` tool input that carries the message body.
 * Was `text` before agent-comms PR#117, now `content`.
 */
export const AGENT_COMMS_CONTENT_FIELD = "content";

/**
 * Legacy tool names that have been retired. Listed here so that any
 * code referencing them triggers a compile-time review via the contract test.
 */
export const AGENT_COMMS_RETIRED_TOOLS = [
  "mcp__agent-comms__reply",
  "mcp__agent-comms__send_message",
] as const;

/**
 * Legacy field names that have been retired.
 */
export const AGENT_COMMS_RETIRED_FIELDS = ["text"] as const;
