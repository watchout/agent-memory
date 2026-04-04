/**
 * FEAT-026: Fetch Discord history via agent-comms webhook adapter.
 * Falls back gracefully if agent-comms is not running.
 */

// Agent-comms webhook port — try common ports or use env override
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || process.env.AGENT_COMMS_PORT;

interface DiscordMessage {
  message_id: string;
  author: string;
  content: string;
  timestamp: string;
  is_bot: boolean;
}

/**
 * Fetch Discord history from agent-comms adapter's /history endpoint.
 * Returns formatted message lines, or empty array if unavailable.
 */
async function fetchFromAdapter(
  channelId: string,
  limit: number,
  port: string
): Promise<string[]> {
  const params = new URLSearchParams({ channel_id: channelId, limit: String(limit) });
  const url = `http://127.0.0.1:${port}/history?${params}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) return [];

  const data = (await resp.json()) as { messages: DiscordMessage[] };
  if (!data.messages || data.messages.length === 0) return [];

  return data.messages.map(
    (m) =>
      `[${m.timestamp}] ${m.author}${m.is_bot ? " (bot)" : ""}: ${m.content.slice(0, 300)}`
  );
}

/**
 * Fetch Discord history for multiple channels.
 * Distributes the limit across channels, returns combined formatted lines.
 * Silently returns empty if agent-comms is unavailable.
 */
export async function fetchDiscordHistory(
  channels: string[],
  totalLimit: number
): Promise<string[]> {
  if (!WEBHOOK_PORT || channels.length === 0 || totalLimit <= 0) {
    return [];
  }

  const perChannelLimit = Math.max(Math.floor(totalLimit / channels.length), 5);
  const results: string[] = [];

  for (const channelId of channels) {
    try {
      const msgs = await fetchFromAdapter(channelId, perChannelLimit, WEBHOOK_PORT);
      results.push(...msgs);
    } catch {
      // agent-comms not running or channel unavailable — skip silently
    }
  }

  // Limit total and sort by timestamp (newest first for display)
  return results.slice(0, totalLimit);
}
