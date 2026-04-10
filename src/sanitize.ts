/**
 * Output sanitization for the MCP transport boundary (AM-029 / PR#69).
 *
 * Why this module exists in its own file:
 *   - The Anthropic API parses MCP tool responses with a strict
 *     RFC 8259 JSON parser. Any string containing an orphaned UTF-16
 *     surrogate code unit gets bounced with `no low surrogate in
 *     string`. JS strings are UTF-16 internally and `.slice(0, n)`
 *     can split surrogate pairs (e.g. emoji), so the orphan is
 *     produced inside our format/preview code, not in the DB.
 *   - Both the helpers (`stripOrphanSurrogates`, `safeText`) live
 *     here so tests can import them without dragging in `src/index.ts`,
 *     which side-effects an MCP server boot at module load.
 */

/**
 * Strip orphaned UTF-16 surrogate code units from a string.
 *
 * Walks the input code-unit by code-unit:
 *   - well-formed surrogate pairs (high D800–DBFF + low DC00–DFFF)
 *     pass through untouched
 *   - high surrogate without a following low surrogate → dropped
 *   - lone low surrogate without a preceding high surrogate → dropped
 *   - everything else → passes through
 *
 * Non-string input is returned as-is so the helper is safe to apply
 * defensively in places where TypeScript can't prove the type.
 */
export function stripOrphanSurrogates(input: string): string {
  if (typeof input !== "string") return input;
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // High surrogate: must be followed by a low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
        continue;
      }
      // Orphan high surrogate — drop it
      continue;
    }
    // Lone low surrogate (no preceding high) — drop it
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    out += input[i];
  }
  return out;
}

/**
 * Build an MCP `{type: "text", text: ...}` content block with the
 * text already sanitized via `stripOrphanSurrogates`.
 *
 * **Convention**: every MCP tool handler in `src/index.ts` returns
 * its text content through this helper. There are no exceptions —
 * applying it at every output boundary is what makes the sanitizer
 * effective. New tool handlers must follow the same pattern.
 */
export function safeText(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text: stripOrphanSurrogates(text) };
}
