/**
 * U12 helper (261113-store-resolution-fix): record the SQL a store really sends, and split each statement into the table and
 * the columns it uses, so a test can check them against the migrated schema. A statement this reader cannot split is reported,
 * never skipped. It holds no test and decides nothing about a store.
 */
import pg from "pg";

export interface SqlUse {
  kind: "transaction" | "insert" | "update" | "select";
  table: string | null;
  columns: string[];
}
export type SqlReading = SqlUse | { unparsable: string };

/** Records the text of every statement `run` sends through the pg client (pool.query goes through it too); restores the client after. */
export async function traceStatements(run: () => Promise<void>): Promise<string[]> {
  const statements: string[] = [];
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = prototype.query;
  prototype.query = function patched(this: unknown, ...args: unknown[]) {
    const first = args[0];
    const text = typeof first === "string" ? first : (first as { text?: unknown } | undefined)?.text;
    if (typeof text === "string") statements.push(text);
    return original.apply(this, args);
  };
  try {
    await run();
  } finally {
    prototype.query = original;
  }
  return statements;
}

const WORDS = new Set([
  "and", "or", "not", "is", "null", "now", "desc", "asc", "in", "true", "false", "any", "excluded", "limit", "text",
]);

/** The column names a condition or an assignment mentions: literals, parameters and casts removed, function names left out. */
function namesIn(expression: string, table: string): string[] {
  const bare = expression
    .replace(/'[^']*'/g, " ")
    .replace(/\$\d+(::\w+)?/g, " ")
    .replace(/::\w+/g, " ");
  const names: string[] = [];
  for (const match of bare.matchAll(/(?:\b(\w+)\.)?\b([a-z_][a-z0-9_]*)\b(?!\s*\()/g)) {
    const qualifier = match[1];
    const name = match[2] as string;
    if (qualifier !== undefined && qualifier.toLowerCase() !== "excluded" && qualifier !== table) names.push(`${qualifier}.${name}`);
    else if (!WORDS.has(name)) names.push(name);
  }
  return names;
}

function topLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function targetsAndValues(set: string, table: string): string[] {
  const columns: string[] = [];
  for (const assignment of topLevelCommas(set)) {
    const eq = assignment.indexOf("=");
    if (eq < 1) return ["<assignment:" + assignment + ">"];
    columns.push(assignment.slice(0, eq).trim(), ...namesIn(assignment.slice(eq + 1), table));
  }
  return columns;
}

function returning(rest: string, table: string): string[] {
  const match = rest.match(/\bRETURNING\s+(.*)$/i);
  if (!match || (match[1] as string).trim() === "*") return [];
  return topLevelCommas(match[1] as string).flatMap((item) => namesIn(item, table));
}

export function readStatement(statement: string): SqlReading {
  const sql = statement.replace(/\s+/g, " ").trim().replace(/;$/, "");
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { kind: "transaction", table: null, columns: [] };

  const insert = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES \(.*?\)(?: ON CONFLICT (?:\(([^)]*)\) )?(DO NOTHING|DO UPDATE SET (.*?)))?(?: RETURNING .*)?$/i);
  if (insert) {
    const table = insert[1] as string;
    const columns = (insert[2] as string).split(",").map((name) => name.trim());
    if (insert[3]) columns.push(...(insert[3] as string).split(",").map((name) => name.trim()));
    if (insert[5]) columns.push(...targetsAndValues(insert[5].replace(/ RETURNING .*$/i, ""), table));
    columns.push(...returning(sql, table));
    return { kind: "insert", table, columns };
  }

  const update = sql.match(/^UPDATE (\w+) SET (.*?) WHERE (.*?)(?: RETURNING .*)?$/i);
  if (update) {
    const table = update[1] as string;
    return {
      kind: "update",
      table,
      columns: [...targetsAndValues(update[2] as string, table), ...namesIn(update[3] as string, table), ...returning(sql, table)],
    };
  }

  const select = sql.match(/^SELECT \* FROM (\w+)(?: WHERE (.*?))?(?: ORDER BY (.*?))?(?: LIMIT \d+)?$/i);
  if (select) {
    const table = select[1] as string;
    return {
      kind: "select",
      table,
      columns: [...namesIn(select[2] ?? "", table), ...namesIn(select[3] ?? "", table)],
    };
  }

  return { unparsable: sql };
}

export interface SqlProblem {
  statement: string;
  problem: string;
}

/** Every statement must be readable, name a table that exists, and use only columns that table has. `schema` maps table → column names. */
export function checkStatements(statements: string[], schema: ReadonlyMap<string, ReadonlySet<string>>): { used: Map<string, Set<string>>; problems: SqlProblem[] } {
  const used = new Map<string, Set<string>>();
  const problems: SqlProblem[] = [];
  for (const statement of statements) {
    const reading = readStatement(statement);
    if ("unparsable" in reading) {
      problems.push({ statement, problem: "unparsable statement" });
      continue;
    }
    if (reading.table === null) continue;
    const columns = schema.get(reading.table);
    if (!columns) {
      problems.push({ statement, problem: `table ${reading.table} is not in the migrated schema` });
      continue;
    }
    const seen = used.get(reading.table) ?? new Set<string>();
    for (const column of reading.columns) {
      seen.add(column);
      if (!columns.has(column)) problems.push({ statement, problem: `${reading.table}.${column} is not in the migrated schema` });
    }
    used.set(reading.table, seen);
  }
  return { used, problems };
}
