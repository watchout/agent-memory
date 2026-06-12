import { homedir } from "os";

export const REDACTION_VERSION = "am034-redaction-v2";

export interface RedactionResult {
  text: string;
  redaction_count: number;
  redaction_version: string;
}

const SECRET_PATTERNS: RegExp[] = [
  // PEM blocks first: their multi-line body must vanish as one unit
  // before token-shaped patterns can nibble at the base64 inside.
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/g,
  // GitHub token family: ghp_ (PAT), gho_ (OAuth), ghu_ (user-to-server),
  // ghs_ (server-to-server), ghr_ (refresh).
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // Order matters (AM-031 run 2 incident): sk-* / sk_* families must
  // run before AKIA so compound fixtures like sk-test-AKIA... and
  // sk_test_AKIA... do not survive as a partial prefix.
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // Stripe secret / restricted keys + webhook signing secrets.
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bwhsec_[A-Za-z0-9]{10,}\b/g,
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
// Secret-bearing URL query parameters: keep the parameter name, drop
// the value. Keywords are end-anchored on the param name to limit
// false positives (e.g. "?design=" must not match "sig").
const URL_QUERY_SECRET_RE =
  /([?&][A-Za-z0-9_.-]*(?:token|secret|key|password|passwd|credential|signature|sig|auth)=)[^&#\s"'<>]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d[\d .()/-]{8,}\d)\b/g;

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

  const queryRedacted = text.replace(URL_QUERY_SECRET_RE, (_match, prefix: string) => {
    redactionCount++;
    return `${prefix}[REDACTED]`;
  });
  text = queryRedacted;

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
