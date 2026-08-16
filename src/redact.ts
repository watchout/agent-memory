import { homedir } from "os";

export const REDACTION_VERSION = "am031-redaction-v1";

export interface RedactionResult {
  text: string;
  redaction_count: number;
  redaction_version: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  /\b(?:anthropic|claude|openai|google|gemini|voyage|slack|discord|aws|azure)[_-]?(?:api[_-]?)?(?:key|token|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
];

const CREDENTIAL_ENV_RE =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|DATABASE_URL)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi;

const URL_CREDENTIAL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/gi;
const DATABASE_URL_RE =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi;
const URL_QUERY_SECRET_RE =
  /([?&](?:access_token|api[_-]?key|auth|key|password|secret|signature|token)=)[^&\s"'<>]+/gi;
const WEBHOOK_URL_RE =
  /\bhttps:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks|[^/\s]+\/webhook[s]?\/)[^\s"'<>]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// A digit run counts as a telephone number only when it carries an explicit
// phone marker: a leading "+" country code, separators between digit groups, or
// a phone label directly in front of it. A bare undelimited digit run is an
// opaque identifier (GitHub comment id, epoch timestamp, backup suffix) and is
// kept, because recovery evidence is worthless once its identifiers are erased.
const PHONE_CANDIDATE_RE =
  /(?<!\w)\(?\+?\d[\d\s.()-]{4,20}\d(?:\s*(?:x|ext\.?)\s*\d{1,5})?(?!\w)/g;
const PHONE_EXTENSION_RE = /\s*(?:x|ext\.?)\s*\d{1,5}$/i;
const PHONE_LABEL_RE = /(?:tel|telephone|phone|mobile|fax|電話番号|電話|携帯)[\s:=.-]*$/i;
const PHONE_LABEL_LOOKBACK = 24;

function isTelephoneNumber(candidate: string, preceding: string): boolean {
  const core = candidate.replace(PHONE_EXTENSION_RE, "");
  const digitCount = core.replace(/\D/g, "").length;

  if (core.startsWith("+") || core.startsWith("(+")) {
    return digitCount >= 8 && digitCount <= 15;
  }

  const groups = core.split(/\D+/).filter(Boolean);
  if (groups.length >= 2) {
    return groups[groups.length - 1].length === 4 && digitCount >= 9 && digitCount <= 15;
  }

  return PHONE_LABEL_RE.test(preceding) && digitCount >= 10 && digitCount <= 11;
}

function redactPhoneNumbers(input: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(PHONE_CANDIDATE_RE, (match: string, ...rest: unknown[]) => {
    const offset = rest[rest.length - 2] as number;
    const full = rest[rest.length - 1] as string;
    const preceding = full.slice(Math.max(0, offset - PHONE_LABEL_LOOKBACK), offset);
    if (!isTelephoneNumber(match, preceding)) return match;
    count++;
    return "[REDACTED_PHONE]";
  });
  return { text, count };
}

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

  const databaseUrlRedacted = applyRedaction(text, DATABASE_URL_RE, "[REDACTED_DATABASE_URL]");
  text = databaseUrlRedacted.text;
  redactionCount += databaseUrlRedacted.count;

  const querySecretRedacted = text.replace(URL_QUERY_SECRET_RE, (_match, prefix: string) => {
    redactionCount++;
    return `${prefix}[REDACTED]`;
  });
  text = querySecretRedacted;

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

  const phoneResult = redactPhoneNumbers(text);
  text = phoneResult.text;
  redactionCount += phoneResult.count;

  return {
    text,
    redaction_count: redactionCount,
    redaction_version: REDACTION_VERSION,
  };
}
