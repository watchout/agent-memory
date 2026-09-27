/** FEAT-026: Optional Discord history via the agent-comms webhook adapter. */
export type DiscordHistoryStatus =
  | { state: "ok"; reason: null }
  | { state: "unavailable"; reason: string };

export interface DiscordHistoryResult {
  discordHistory: string[];
  discord_history_status: DiscordHistoryStatus;
}

interface DiscordMessage {
  message_id: string;
  author: string;
  content: string;
  timestamp: string;
  is_bot: boolean;
}

function unavailable(reason: string): DiscordHistoryResult {
  return { discordHistory: [], discord_history_status: { state: "unavailable", reason } };
}

async function fetchFromAdapter(
  channelId: string,
  limit: number,
  port: string
): Promise<DiscordHistoryResult> {
  const params = new URLSearchParams({ channel_id: channelId, limit: String(limit) });
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/history?${params}`, { signal: AbortSignal.timeout(5000) });
  } catch {
    return unavailable("connection_failed");
  }
  if (!response.ok) return unavailable(`http_error:${response.status}`);

  try {
    const data = (await response.json()) as { messages: DiscordMessage[] };
    if (!Array.isArray(data.messages)) return unavailable("invalid_response");
    return {
      discordHistory: data.messages.map(m =>
        `[${m.timestamp}] ${m.author}${m.is_bot ? " (bot)" : ""}: ${m.content.slice(0, 300)}`),
      discord_history_status: { state: "ok", reason: null },
    };
  } catch {
    return unavailable("invalid_response");
  }
}

/** Preserve received messages, but never label a partial/failed observation as ok. */
export async function fetchDiscordHistory(
  channels: string[],
  totalLimit: number
): Promise<DiscordHistoryResult> {
  const port = process.env.WEBHOOK_PORT || process.env.AGENT_COMMS_PORT;
  if (!port) return unavailable("port_not_configured");
  if (channels.length === 0 || totalLimit <= 0) return unavailable("history_not_requested");

  const perChannelLimit = Math.max(Math.floor(totalLimit / channels.length), 5);
  const discordHistory: string[] = [];
  let status: DiscordHistoryStatus = { state: "ok", reason: null };
  for (const channelId of channels) {
    const result = await fetchFromAdapter(channelId, perChannelLimit, port);
    discordHistory.push(...result.discordHistory);
    // The first unavailable channel in configured order supplies the reason.
    if (status.state === "ok" && result.discord_history_status.state === "unavailable") {
      status = result.discord_history_status;
    }
  }
  return { discordHistory: discordHistory.slice(0, totalLimit), discord_history_status: status };
}
