/**
 * Which store a hook opens (261113-store-resolution-fix). One decision for every entry that has to agree on the
 * place a seat's memory lives: the SessionStart loaders, the two Stop hooks, the hand-off commit, restart-cli and the
 * runtime-event worker. The order is: the environment, then the `database_url` of the user config, then the local
 * default (SQLite). It fails closed: a setting that is present but unusable is refused, never read as "absent".
 *
 * The core (`decideStore`) takes the environment and a reader of the user config as arguments and reads neither the
 * clock, the random source nor the process environment by itself (standard S4). `readUserConfig` is the thin adapter
 * that touches the file system. A PostgreSQL URL (it can hold credentials) lives only in an opaque target.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";

export const CODEX_USER_CONFIG_RELATIVE_PATH = ".agent-memory/config.json" as const;
export const KUSABI_STORE_BINDING_HASH_VERSION = "kusabi-store-binding/v1" as const;
/** The names of the two environment variables `decideStore` reads first (the backend, the PostgreSQL URL), for a caller that builds its own small environment. */
export const STORE_ENV_VARS = Object.freeze({ backend: "AGENT_MEMORY_DB_TYPE", url: "AGENT_MEMORY_DATABASE_URL" } as const);

export type StoreBackendName = "postgres" | "sqlite" | "json";
export type StoreSource = "environment" | "user_config" | "local_default";

/** A closed set of kinds of error. Each is a mark of what was wrong with the setting, never a value, a URL or a path. */
export type StoreRefusalReason =
  | "unknown_db_type"
  | "env_url_shape"
  | "config_kind"
  | "config_read"
  | "config_content"
  | "target_missing";

const TARGET_URLS = new WeakMap<StoreTarget, string>();

/**
 * The place a PostgreSQL store is reached. It prints, stringifies and serializes as a fixed word; only `reveal()`
 * returns the URL, and only the code that opens the store or builds its binding digest calls it.
 */
export class StoreTarget {
  constructor(url: string) {
    TARGET_URLS.set(this, url);
  }

  reveal(): string {
    return TARGET_URLS.get(this) as string;
  }

  toString(): string {
    return "[store-target]";
  }

  toJSON(): string {
    return "[store-target]";
  }

  [inspect.custom](): string {
    return "[store-target]";
  }
}

export type StoreResolution =
  | {
    backend: "postgres";
    source: StoreSource;
    target: StoreTarget;
    /** The user config was read and its content looked at. */
    config_seen: boolean;
    ignores_postgres_url: false;
  }
  | {
    backend: "sqlite" | "json";
    source: StoreSource;
    target: null;
    config_seen: boolean;
    /** The environment names this backend although it also holds a PostgreSQL URL. */
    ignores_postgres_url: boolean;
  };

export type StoreDecision =
  | { ok: true; resolution: StoreResolution }
  | { ok: false; reason: StoreRefusalReason };

export type StoreConfigRead =
  | { status: "absent" }
  | { status: "read"; content: unknown }
  | { status: "unreadable"; reason: "config_kind" | "config_read" | "config_content" };

export class StoreRefusedError extends Error {
  constructor(readonly reason: StoreRefusalReason) {
    super(storeRefusedReason(reason));
    this.name = "StoreRefusedError";
  }
}

/** The text a hook's evidence carries for a refusal. It names the kind of error only. */
export const storeRefusedReason = (reason: StoreRefusalReason): `store_refused:${StoreRefusalReason}` =>
  `store_refused:${reason}`;

function postgresUrl(value: unknown): value is string {
  return typeof value === "string" && /^postgres(?:ql)?:\/\//.test(value);
}

const refuse = (reason: StoreRefusalReason): StoreDecision => ({ ok: false, reason });

/**
 * The decision. `readConfig` is called at most once and not at all when the environment decides, so a broken user
 * config cannot add a failure to a seat that names its store in the environment.
 */
export function decideStore(env: NodeJS.ProcessEnv, readConfig: () => StoreConfigRead): StoreDecision {
  const dbType = (env[STORE_ENV_VARS.backend] ?? "").toLowerCase();
  const environmentUrl = env[STORE_ENV_VARS.url] || env.DATABASE_URL || undefined;
  if (dbType === "sqlite" || dbType === "json") {
    return {
      ok: true,
      resolution: {
        backend: dbType,
        source: "environment",
        target: null,
        config_seen: false,
        ignores_postgres_url: environmentUrl !== undefined && environmentUrl.startsWith("postgres"),
      },
    };
  }
  if (dbType !== "" && dbType !== "postgres") return refuse("unknown_db_type");

  if (environmentUrl !== undefined) {
    if (!postgresUrl(environmentUrl)) return refuse("env_url_shape");
    return {
      ok: true,
      resolution: {
        backend: "postgres",
        source: "environment",
        target: new StoreTarget(environmentUrl),
        config_seen: false,
        ignores_postgres_url: false,
      },
    };
  }

  const read = readConfig();
  if (read.status === "unreadable") return refuse(read.reason);
  const content = read.status === "read" ? read.content : undefined;
  if (read.status === "read" && (content === null || typeof content !== "object" || Array.isArray(content))) {
    return refuse("config_content");
  }
  const configUrl = content === undefined ? undefined : (content as Record<string, unknown>).database_url;
  if (configUrl === undefined) {
    if (dbType === "postgres") return refuse("target_missing");
    return {
      ok: true,
      resolution: {
        backend: "sqlite",
        source: "local_default",
        target: null,
        config_seen: read.status === "read",
        ignores_postgres_url: false,
      },
    };
  }
  if (!postgresUrl(configUrl)) return refuse("config_content");
  return {
    ok: true,
    resolution: {
      backend: "postgres",
      source: "user_config",
      target: new StoreTarget(configUrl),
      config_seen: true,
      ignores_postgres_url: false,
    },
  };
}

/** The adapter: only a missing file is "absent"; every other failure to read it is reported as a failure. */
export function readUserConfig(path: string): StoreConfigRead {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return { status: "unreadable", reason: "config_read" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { status: "unreadable", reason: "config_kind" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { status: "unreadable", reason: "config_read" };
  }
  try {
    return { status: "read", content: JSON.parse(text) };
  } catch {
    return { status: "unreadable", reason: "config_content" };
  }
}

export const defaultUserConfigPath = (): string => join(homedir(), CODEX_USER_CONFIG_RELATIVE_PATH);

export function resolveStore(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = defaultUserConfigPath(),
): StoreDecision {
  return decideStore(env, () => readUserConfig(configPath));
}

/** `resolveStore` for a caller that cannot go on without a store: a refusal throws, carrying the kind of error only. */
export function requireStore(
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = defaultUserConfigPath(),
): StoreResolution {
  const decision = resolveStore(env, configPath);
  if (!decision.ok) throw new StoreRefusedError(decision.reason);
  return decision.resolution;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function kusabiStoreBindingSha256(backend: StoreBackendName, locator: string): string {
  return sha256(`${KUSABI_STORE_BINDING_HASH_VERSION}\0${backend}\0${locator}`);
}

export function localStoreBindingSha256(backend: "sqlite" | "json", env: NodeJS.ProcessEnv): string {
  const defaultPath = backend === "sqlite"
    ? join(homedir(), ".agent-memory", "memory.db")
    : join(homedir(), ".agent-memory");
  const configuredPath = backend === "sqlite" ? env.AGENT_MEMORY_DB_PATH : undefined;
  return kusabiStoreBindingSha256(backend, resolve(configuredPath || defaultPath));
}

/** The digest that names the place a resolution opens. SessionStart evidence and the runtime-event worker both build it here. */
export function storeBindingSha256(resolution: StoreResolution, env: NodeJS.ProcessEnv): string {
  return resolution.backend === "postgres"
    ? kusabiStoreBindingSha256("postgres", resolution.target.reveal())
    : localStoreBindingSha256(resolution.backend, env);
}

/** The digest of a path, for evidence that says a config file was read without naming it. */
export function configPathSha256(configPath: string): string {
  return sha256(resolve(configPath));
}
