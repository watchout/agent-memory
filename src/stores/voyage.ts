/**
 * Voyage AI embedding helper for agent-memory.
 * Uses HTTP API directly (no SDK dependency).
 * Falls back gracefully when VOYAGE_API_KEY is not set.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite"; // 512-dim, fast, good for short text
export const EMBEDDING_DIM = 512;

let _apiKey: string | null | undefined = undefined; // undefined = not yet loaded

function loadApiKey(): string | null {
  if (_apiKey !== undefined) return _apiKey;

  // 1. Check environment variable
  if (process.env.VOYAGE_API_KEY) {
    _apiKey = process.env.VOYAGE_API_KEY;
    return _apiKey;
  }

  // 2. Check ~/.agent-com-api-keys file
  try {
    const keysFile = join(homedir(), ".agent-com-api-keys");
    const content = readFileSync(keysFile, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^VOYAGE_API_KEY=(.+)$/);
      if (match) {
        _apiKey = match[1].trim();
        return _apiKey;
      }
    }
  } catch {
    // File doesn't exist or unreadable
  }

  _apiKey = null;
  return null;
}

/**
 * Check if Voyage AI embeddings are available.
 */
export function isVoyageAvailable(): boolean {
  return loadApiKey() !== null;
}

/**
 * Generate embeddings for one or more texts.
 * Returns null if API key is not set (graceful fallback).
 * Throws on API errors.
 */
export async function generateEmbeddings(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][] | null> {
  const apiKey = loadApiKey();
  if (!apiKey) return null;

  const resp = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Voyage AI API error (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data.map((d) => d.embedding);
}

/**
 * Generate a single embedding. Returns null if unavailable or on error.
 * Errors are logged but never thrown — embedding is best-effort.
 */
export async function generateEmbedding(
  text: string,
  inputType: "document" | "query" = "document"
): Promise<number[] | null> {
  try {
    const results = await generateEmbeddings([text], inputType);
    return results ? results[0] : null;
  } catch (err) {
    process.stderr.write(`[agent-memory] embedding generation failed (non-fatal): ${err}\n`);
    return null;
  }
}

/**
 * Format embedding as pgvector literal string: '[0.1,0.2,...]'
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
