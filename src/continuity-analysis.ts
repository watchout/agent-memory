import type { Decision } from "./stores/types.js";

export type ContinuityRiskKind = "contradictory_decisions";

export interface ContinuityRisk {
  kind: ContinuityRiskKind;
  missing_context_key: "contradictory_decisions";
  severity: "degraded";
  summary: string;
  source_refs: string[];
  source_ids: string[];
}

type Polarity = "positive" | "negative";

const POSITIVE_PATTERN = /\b(?:use|enable|allow|adopt|keep|choose|require|requires|required|must)\b/;
const NEGATIVE_PATTERN = /\b(?:do not|don't|must not|never|avoid|disable|reject|remove|stop|forbid|forbidden)\b/;
const STRIP_PATTERN = /\b(?:do not|don't|must not|never|avoid|disable|reject|remove|stop|forbid|forbidden|use|enable|allow|adopt|keep|choose|require|requires|required|must|should|decision|decide|decided)\b/g;
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "into",
  "onto",
  "when",
  "then",
  "than",
  "will",
  "shall",
  "only",
  "default",
  "current",
]);

export function detectContinuityRisks(input: { decisions: Decision[] }): ContinuityRisk[] {
  const risks: ContinuityRisk[] = [];
  const decisions = input.decisions.map((decision) => ({
    decision,
    polarity: polarityFor(decision.decision),
    tokens: topicTokens(decision.decision),
  }));

  for (let i = 0; i < decisions.length; i++) {
    for (let j = i + 1; j < decisions.length; j++) {
      const left = decisions[i];
      const right = decisions[j];
      if (!left.polarity || !right.polarity || left.polarity === right.polarity) continue;
      if (!topicsOverlap(left.tokens, right.tokens)) continue;
      risks.push(contradictoryDecisionsRisk(left.decision, right.decision));
      if (risks.length >= 3) return risks;
    }
  }

  return risks;
}

function contradictoryDecisionsRisk(left: Decision, right: Decision): ContinuityRisk {
  const source_refs = [`decision:${left.id}`, `decision:${right.id}`];
  return {
    kind: "contradictory_decisions",
    missing_context_key: "contradictory_decisions",
    severity: "degraded",
    summary: `Active decisions disagree without a supersede/provenance winner. Sources: ${source_refs.join(", ")}.`,
    source_refs,
    source_ids: [left.id, right.id],
  };
}

function polarityFor(text: string): Polarity | null {
  const normalized = text.toLowerCase();
  if (NEGATIVE_PATTERN.test(normalized)) return "negative";
  if (POSITIVE_PATTERN.test(normalized)) return "positive";
  return null;
}

function topicTokens(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(STRIP_PATTERN, " ")
    .replace(/[^a-z0-9#_-]+/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function topicsOverlap(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return false;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  const smaller = Math.min(left.size, right.size);
  const union = left.size + right.size - overlap;
  return overlap >= Math.min(3, smaller) && overlap / union >= 0.45;
}
