/**
 * The one check of the node path an installer writes at the head of a hook command (FR10.7).
 * Accepted: an absolute, already normalized path whose last name is exactly `node` and that reaches an
 * executable regular file (a symlink is fine, so a version independent path stays version independent).
 * Independent of PATH and of the current directory.
 */
import { accessSync, constants, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

export type HookNodePathRefusal =
  | "not_absolute"
  | "contains_nul"
  | "not_normalized"
  | "basename_not_node"
  | "not_found"
  | "not_file"
  | "not_executable";

export type HookNodePathCheck = { ok: true } | { ok: false; reason: HookNodePathRefusal };

const refuse = (reason: HookNodePathRefusal): HookNodePathCheck => ({ ok: false, reason });

export function checkHookNodePath(value: unknown): HookNodePathCheck {
  if (typeof value !== "string") return refuse("not_absolute");
  if (value.includes("\0")) return refuse("contains_nul");
  if (!isAbsolute(value)) return refuse("not_absolute");
  if (resolve(value) !== value) return refuse("not_normalized");
  if (basename(value) !== "node") return refuse("basename_not_node");
  let isFile: boolean;
  try {
    isFile = statSync(value).isFile();
  } catch {
    return refuse("not_found");
  }
  if (!isFile) return refuse("not_file");
  try {
    accessSync(value, constants.X_OK);
  } catch {
    return refuse("not_executable");
  }
  return { ok: true };
}

/** Returns the value as given (not resolved) or throws a one line error that carries no raw control character. */
export function assertHookNodePath(value: string): string {
  const check = checkHookNodePath(value);
  if (!check.ok) throw new Error(`invalid node path (${check.reason}): ${JSON.stringify(value)}`);
  return value;
}
