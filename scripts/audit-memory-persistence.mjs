#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const KNOWN_TABLES = [
  "decisions",
  "task_states",
  "knowledge",
  "conversation_events",
  "raw_events",
  "recovery_quality_log",
  "selected_restart_packs",
  "catch_up_log",
];

const SENSITIVE_KEY_RE = /url|token|key|secret|password|authorization/i;
const MEMORY_SERVER_RE = /wasurezu|agent-memory|kusabi/i;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"]);

function parseArgs(argv) {
  const args = {
    devRoot: "/Users/yuji/Developer",
    agentMemoryDir: join(homedir(), ".agent-memory"),
    maxDepth: 4,
    includePostgres: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dev-root") args.devRoot = argv[++i];
    else if (arg === "--agent-memory-dir") args.agentMemoryDir = argv[++i];
    else if (arg === "--max-depth") args.maxDepth = Number(argv[++i]);
    else if (arg === "--include-postgres") args.includePostgres = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.devRoot = resolve(args.devRoot);
  args.agentMemoryDir = resolve(args.agentMemoryDir);
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/audit-memory-persistence.mjs [options]

Read-only audit of local Wasurezu/Kusabi memory persistence bindings.

Options:
  --dev-root PATH            Workspace root to scan. Default: /Users/yuji/Developer
  --agent-memory-dir PATH    Local memory dir. Default: ~/.agent-memory
  --max-depth N              Directory scan depth. Default: 4
  --include-postgres         Query PostgreSQL counts using ~/.agent-memory/config.json or env URL
  --json                     Emit JSON instead of Markdown
`);
}

function sha(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function displayPath(path) {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function redactValue(key, value) {
  if (value === undefined || value === null) return value;
  const stringValue = String(value);
  if (SENSITIVE_KEY_RE.test(key)) return `<redacted:sha256:${sha(stringValue)}>`;
  return stringValue;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { __parse_error: String(err) };
  }
}

function walkConfigFiles(root, maxDepth) {
  const results = [];

  function visit(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full, depth + 1);
        continue;
      }

      if (entry.isFile() && entry.name === ".mcp.json") {
        results.push(full);
      } else if (entry.isFile() && entry.name === "settings.json" && basename(dirname(full)) === ".claude") {
        results.push(full);
      }
    }
  }

  visit(root, 0);
  return results.sort();
}

function getServers(config) {
  if (!config || config.__parse_error) return {};
  return config.mcpServers || config.servers || config.mcp?.servers || {};
}

function commandEntrypoint(server) {
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const distArg = args.find((arg) => /\/dist\/index\.js$/.test(arg));
  if (distArg) return distArg;
  const packageArg = args.find((arg) => MEMORY_SERVER_RE.test(arg));
  if (packageArg) return packageArg;
  return server.command ? String(server.command) : "";
}

function classifyBackend(env) {
  const dbType = String(env.AGENT_MEMORY_DB_TYPE || "").toLowerCase();
  const explicitUrl = env.AGENT_MEMORY_DATABASE_URL || env.DATABASE_URL;
  const dbPath = env.AGENT_MEMORY_DB_PATH;

  if (dbType === "postgres") return { backend: "postgres-explicit", dbPath: "" };
  if (dbType === "sqlite") return { backend: "sqlite-explicit", dbPath: dbPath || "~/.agent-memory/memory.db" };
  if (dbType === "json") return { backend: "json-explicit", dbPath: "~/.agent-memory/*.json" };
  if (explicitUrl) return { backend: "postgres-url-fail-closed", dbPath: "" };
  return { backend: "sqlite-default", dbPath: dbPath || "~/.agent-memory/memory.db" };
}

function auditBinding(file, name, server, repoRoot) {
  const env = server.env || {};
  const { backend, dbPath } = classifyBackend(env);
  const entrypoint = commandEntrypoint(server);
  const warnings = [];

  if (!env.AGENT_MEMORY_AGENT_ID) warnings.push("missing_agent_id_env_uses_default");
  if (!env.AGENT_MEMORY_PROJECT) warnings.push("missing_project_env");
  if (backend === "postgres-url-fail-closed") warnings.push("postgres_url_without_explicit_db_type");
  if (backend === "sqlite-default") warnings.push("sqlite_default_local_store");
  if (backend === "sqlite-explicit") warnings.push("sqlite_explicit_local_store");
  if (env.DATABASE_URL && String(env.AGENT_MEMORY_DB_TYPE || "").toLowerCase() === "sqlite") {
    warnings.push("database_url_ignored_by_sqlite_mode");
  }
  if (entrypoint.includes("/Developer/agent-memory/") && !entrypoint.includes(`${repoRoot}/`)) {
    warnings.push("entrypoint_targets_other_checkout");
  }
  if (entrypoint.includes("/Developer/wasurezu-main/") && !entrypoint.includes(`${repoRoot}/`)) {
    warnings.push("entrypoint_targets_other_checkout");
  }

  return {
    file,
    server: name,
    command: server.command ? String(server.command) : "",
    entrypoint,
    agent_id: env.AGENT_MEMORY_AGENT_ID || "",
    project: env.AGENT_MEMORY_PROJECT || "",
    backend,
    db_path: redactValue("AGENT_MEMORY_DB_PATH", dbPath),
    db_url: env.AGENT_MEMORY_DATABASE_URL
      ? redactValue("AGENT_MEMORY_DATABASE_URL", env.AGENT_MEMORY_DATABASE_URL)
      : env.DATABASE_URL
        ? redactValue("DATABASE_URL", env.DATABASE_URL)
        : "",
    warnings,
  };
}

function auditMcpBindings(args) {
  const repoRoot = resolve(join(dirname(new URL(import.meta.url).pathname), ".."));
  const files = walkConfigFiles(args.devRoot, args.maxDepth);
  const bindings = [];
  const parseErrors = [];

  for (const file of files) {
    const config = readJson(file);
    if (config.__parse_error) {
      parseErrors.push({ file, error: config.__parse_error });
      continue;
    }
    const servers = getServers(config);
    for (const [name, server] of Object.entries(servers)) {
      const blob = JSON.stringify({ name, server });
      if (!MEMORY_SERVER_RE.test(blob)) continue;
      bindings.push(auditBinding(file, name, server, repoRoot));
    }
  }

  return { bindings, parseErrors };
}

function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sqliteValue(dbPath, sql) {
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
}

function sqliteTableExists(dbPath, table) {
  return sqliteValue(
    dbPath,
    `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}';`
  ) === "1";
}

function sqliteColumnExists(dbPath, table, column) {
  const output = sqliteValue(dbPath, `PRAGMA table_info(${table});`);
  return output.split("\n").some((line) => line.split("|")[1] === column);
}

function auditSqlite(agentMemoryDir) {
  if (!commandExists("sqlite3")) {
    return { available: false, files: [], error: "sqlite3_not_found" };
  }
  if (!existsSync(agentMemoryDir)) {
    return { available: true, files: [], error: "agent_memory_dir_not_found" };
  }

  const files = readdirSync(agentMemoryDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => join(agentMemoryDir, name))
    .sort();

  const reports = [];
  for (const file of files) {
    const report = {
      file,
      size_bytes: statSync(file).size,
      tables: {},
    };
    for (const table of KNOWN_TABLES) {
      try {
        if (!sqliteTableExists(file, table)) continue;
        const hasCreatedAt = sqliteColumnExists(file, table, "created_at");
        const count = Number(sqliteValue(file, `SELECT COUNT(*) FROM ${table};`) || "0");
        const latest = hasCreatedAt ? sqliteValue(file, `SELECT MAX(created_at) FROM ${table};`) : "";
        report.tables[table] = { count, latest };
      } catch (err) {
        report.tables[table] = { error: String(err) };
      }
    }
    reports.push(report);
  }

  return { available: true, files: reports };
}

async function auditPostgres(includePostgres) {
  if (!includePostgres) return { skipped: true, reason: "pass --include-postgres to query PostgreSQL counts" };

  let url = process.env.AGENT_MEMORY_DATABASE_URL || process.env.DATABASE_URL || "";
  const configPath = join(homedir(), ".agent-memory", "config.json");
  if (!url && existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      url = config.database_url || "";
    } catch {
      // ignore invalid local config
    }
  }
  if (!url) return { skipped: true, reason: "no postgres URL in env or ~/.agent-memory/config.json" };

  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url });
  const tables = {};

  try {
    for (const table of KNOWN_TABLES) {
      const exists = await pool.query("SELECT to_regclass($1) AS name", [table]);
      if (!exists.rows[0].name) continue;

      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name=$1", [table]);
      const colset = new Set(columns.rows.map((row) => row.column_name));
      if (!colset.has("agent_id")) continue;
      const timeCol = colset.has("created_at") ? "created_at" : colset.has("ingested_at") ? "ingested_at" : null;
      const projectSelect = colset.has("project") ? "project," : "";
      const projectGroup = colset.has("project") ? "project," : "";
      const latestSelect = timeCol ? `, max(${timeCol}) AS latest` : "";
      const latestOrder = timeCol ? "latest DESC NULLS LAST" : "count DESC";
      const query = `
        SELECT agent_id, ${projectSelect} count(*)::int AS count ${latestSelect}
        FROM ${table}
        GROUP BY agent_id, ${projectGroup} agent_id
        ORDER BY ${latestOrder}
        LIMIT 20
      `;
      const result = await pool.query(query);
      tables[table] = result.rows;
    }
  } finally {
    await pool.end();
  }

  return { skipped: false, url: redactValue("DATABASE_URL", url), tables };
}

function summarize(bindings, sqlite, postgres) {
  const warningCounts = {};
  for (const binding of bindings) {
    for (const warning of binding.warnings) {
      warningCounts[warning] = (warningCounts[warning] || 0) + 1;
    }
  }

  const backends = {};
  for (const binding of bindings) {
    backends[binding.backend] = (backends[binding.backend] || 0) + 1;
  }

  const sqliteFilesWithRows = sqlite.files?.filter((file) =>
    Object.values(file.tables || {}).some((table) => typeof table.count === "number" && table.count > 0)
  ).length ?? 0;

  return {
    binding_count: bindings.length,
    backend_counts: backends,
    warning_counts: warningCounts,
    sqlite_file_count: sqlite.files?.length ?? 0,
    sqlite_files_with_rows: sqliteFilesWithRows,
    postgres_included: postgres.skipped === false,
  };
}

function mdTable(headers, rows) {
  const escape = (value) => String(value ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|");
  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(" | ")} |`);
  }
  return lines.join("\n");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Memory Persistence Binding Audit");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Dev root: \`${displayPath(report.dev_root)}\``);
  lines.push(`Agent memory dir: \`${displayPath(report.agent_memory_dir)}\``);
  lines.push("");
  lines.push("This audit is read-only. It reports config bindings, storage backends, and row counts; it does not inspect stored memory content.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.summary, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## MCP Bindings");
  lines.push("");
  lines.push(mdTable(
    ["Config", "Server", "Agent", "Project", "Backend", "Entrypoint", "Warnings"],
    report.mcp.bindings.map((binding) => [
      displayPath(binding.file),
      binding.server,
      binding.agent_id || "(default)",
      binding.project || "(none)",
      binding.backend,
      displayPath(binding.entrypoint),
      binding.warnings.join(", "),
    ])
  ));
  lines.push("");
  if (report.mcp.parseErrors.length > 0) {
    lines.push("## Parse Errors");
    lines.push("");
    lines.push(mdTable(["Config", "Error"], report.mcp.parseErrors.map((item) => [displayPath(item.file), item.error])));
    lines.push("");
  }
  lines.push("## SQLite Files");
  lines.push("");
  if (!report.sqlite.available) {
    lines.push(`SQLite audit unavailable: ${report.sqlite.error}`);
  } else if (report.sqlite.files.length === 0) {
    lines.push("No SQLite DB files found.");
  } else {
    lines.push(mdTable(
      ["DB", "Size", "decisions", "task_states", "knowledge", "conversation_events", "raw_events", "recovery_quality_log"],
      report.sqlite.files.map((file) => [
        displayPath(file.file),
        file.size_bytes,
        file.tables.decisions?.count ?? "",
        file.tables.task_states?.count ?? "",
        file.tables.knowledge?.count ?? "",
        file.tables.conversation_events?.count ?? "",
        file.tables.raw_events?.count ?? "",
        file.tables.recovery_quality_log?.count ?? "",
      ])
    ));
  }
  lines.push("");
  lines.push("## PostgreSQL Counts");
  lines.push("");
  if (report.postgres.skipped) {
    lines.push(`Skipped: ${report.postgres.reason}`);
  } else {
    lines.push(`URL: ${report.postgres.url}`);
    for (const [table, rows] of Object.entries(report.postgres.tables)) {
      lines.push("");
      lines.push(`### ${table}`);
      lines.push("");
      const hasProject = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "project"));
      const headers = hasProject ? ["agent_id", "project", "count", "latest"] : ["agent_id", "count", "latest"];
      lines.push(mdTable(headers, rows.map((row) => hasProject
        ? [row.agent_id, row.project ?? "(none)", row.count, row.latest ?? ""]
        : [row.agent_id, row.count, row.latest ?? ""])));
    }
  }
  lines.push("");
  lines.push("## Warning Glossary");
  lines.push("");
  lines.push("- `entrypoint_targets_other_checkout`: MCP config executes another local checkout, so runtime behavior may not match this branch.");
  lines.push("- `postgres_url_without_explicit_db_type`: PostgreSQL URL is set without `AGENT_MEMORY_DB_TYPE=postgres`. Since PR #186 the runtime still fails closed on connection failure, but explicit DB type is clearer operator evidence.");
  lines.push("- `missing_project_env`: writes can land under `project = null`, reducing recovery targeting.");
  lines.push("- `missing_agent_id_env_uses_default`: writes can land under `agent_id = default`.");
  lines.push("- `sqlite_default_local_store` / `sqlite_explicit_local_store`: local DB is not the shared common DB unless explicitly accepted.");
  lines.push("- `database_url_ignored_by_sqlite_mode`: `DATABASE_URL` is present but ignored because SQLite mode is explicit.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mcp = auditMcpBindings(args);
  const sqlite = auditSqlite(args.agentMemoryDir);
  const postgres = await auditPostgres(args.includePostgres);
  const report = {
    generated_at: new Date().toISOString(),
    dev_root: args.devRoot,
    agent_memory_dir: args.agentMemoryDir,
    mcp,
    sqlite,
    postgres,
    summary: summarize(mcp.bindings, sqlite, postgres),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

main().catch((err) => {
  console.error(`[audit-memory-persistence] ${err?.stack || err}`);
  process.exit(1);
});
