import type { ConversationEvent, RawEvent, SaveRawEventInput } from "./types.js";

export function rawEventTypeForConversationRole(role?: string): RawEvent["event_type"] {
  if (role === "user") return "user_message";
  if (role === "assistant") return "assistant_message";
  if (role === "tool") return "tool_result";
  return "runtime_event";
}

export function conversationEventToRawEventInput(event: ConversationEvent): SaveRawEventInput {
  return {
    agent_id: event.agent_id,
    project: event.project,
    host: event.source,
    source: "conversation_event",
    event_type: rawEventTypeForConversationRole(event.role),
    role: event.role,
    content: event.content,
    content_hash: event.content_hash,
    source_ref: {
      table: "conversation_events",
      id: event.id,
      source: event.source,
      source_event_id: event.source_event_id,
      source_path: event.source_path,
    },
    source_event_id: event.id,
    source_path: event.source_path,
    metadata: {
      ...event.metadata,
      compatibility_table: "conversation_events",
      conversation_source: event.source,
      conversation_source_event_id: event.source_event_id,
    },
    occurred_at: event.occurred_at,
  };
}

export function rawEventSourceRef(input: SaveRawEventInput): Record<string, unknown> {
  return input.source_ref ?? {
    source: input.source,
    source_event_id: input.source_event_id,
    source_path: input.source_path,
  };
}
