/**
 * The outer shape of a hook input, checked in one place for every hook entry.
 * Pure: no clock, environment, file or randomness. The entry keeps the type, event, source and
 * identity rules; this function only decides which keys are known and reports the others by name.
 */

export interface HookInputShape {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly max_bytes: number;
}

export type HookInputShapeResult =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, unknown>; readonly ignored_names: readonly string[] }
  | { readonly ok: false; readonly reason: "too_large" | "not_json" | "not_object" | "missing_required" };

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function parseHookInputShape(raw: string, shape: HookInputShape): HookInputShapeResult {
  if (Buffer.byteLength(raw, "utf8") > shape.max_bytes) return { ok: false, reason: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "not_object" };
  const input = value as Record<string, unknown>;
  if (!shape.required.every((key) => hasOwn(input, key))) return { ok: false, reason: "missing_required" };

  const known = new Set<string>([...shape.required, ...shape.optional]);
  const fields = new Map<string, unknown>();
  for (const key of known) {
    if (hasOwn(input, key)) fields.set(key, input[key]);
  }
  const ignored_names = Object.keys(input).filter((key) => !known.has(key)).sort();
  return { ok: true, fields, ignored_names };
}
