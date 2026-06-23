import { homedir } from "os";

export const REDACTION_VERSION = "am031-redaction-v1";

export interface RedactionResult {
  text: string;
  redaction_count: number;
  redaction_version: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bgho_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:anthropic|claude|openai|google|gemini|voyage|slack|discord|aws|azure)[_-]?(?:api[_-]?)?(?:key|token|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

const CREDENTIAL_ENV_RE =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|DATABASE_URL)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi;

const URL_CREDENTIAL_RE = /\b(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi;
const WEBHOOK_URL_RE =
  /\bhttps:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks|[^/\s]+\/webhook[s]?\/)[^\s"'<>]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE =
  /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?:\s*(?:x|ext\.?)\s*\d{1,5})?\b/g;

function applyRedaction(input: string, pattern: RegExp, replacement: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(pattern, () => {
    count++;
    return replacement;
  });
  return { text, count };
}

export function normalizeHomePath(input: string): string {
  const home = homedir();
  return home ? input.split(home).join("~") : input;
}

export function redactText(input: string): RedactionResult {
  let text = normalizeHomePath(input);
  let redactionCount = 0;

  const envRedacted = text.replace(CREDENTIAL_ENV_RE, (_match, name: string) => {
    redactionCount++;
    return `${name}=[REDACTED]`;
  });
  text = envRedacted;

  const urlRedacted = text.replace(URL_CREDENTIAL_RE, (_match, scheme: string) => {
    redactionCount++;
    return `${scheme}[REDACTED]@`;
  });
  text = urlRedacted;

  const webhookRedacted = applyRedaction(text, WEBHOOK_URL_RE, "[REDACTED_WEBHOOK_URL]");
  text = webhookRedacted.text;
  redactionCount += webhookRedacted.count;

  for (const pattern of SECRET_PATTERNS) {
    const result = applyRedaction(text, pattern, "[REDACTED]");
    text = result.text;
    redactionCount += result.count;
  }

  const emailResult = applyRedaction(text, EMAIL_RE, "[REDACTED_EMAIL]");
  text = emailResult.text;
  redactionCount += emailResult.count;

  const phoneResult = applyRedaction(text, PHONE_RE, "[REDACTED_PHONE]");
  text = phoneResult.text;
  redactionCount += phoneResult.count;

  return {
    text,
    redaction_count: redactionCount,
    redaction_version: REDACTION_VERSION,
  };
}
