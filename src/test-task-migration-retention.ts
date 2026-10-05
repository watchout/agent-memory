import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs, { type Database } from "sql.js";
import pg from "pg";
import { SqliteStore } from "./stores/sqlite-store.js";
import { PgStore } from "./stores/pg-store.js";

function rows(db: Database, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    const result: Record<string, unknown>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}

export async function testSqliteTaskMigrationRetention(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "task-retention-"));
  const path = join(root, "memory.db");
  const SQL = await initSqlJs();
  try {
    const fresh = new SqliteStore(path);
    await fresh.initialize(); await fresh.close();
    let db = new SQL.Database(await readFile(path));
    db.run("DROP INDEX uq_task_states_agent_task_id");
    db.run("ALTER TABLE task_states ADD COLUMN legacy_extra TEXT");
    const id = randomUUID(), newest = randomUUID();
    for (const [key, content] of [[id, "old full history"], [newest, "latest"]]) {
      db.run(`INSERT INTO task_states (id,agent_id,project,task,task_id,status,progress,files_modified,next_steps,created_at,updated_at,embedding,legacy_extra)
        VALUES (?, 'retention-seat', 'alpha', 'task', 'task', 'in_progress', ?, '["a.ts"]', 'continue', '2026-01-01', '2026-01-02', '[1,0]', 'unknown retained column')`, [key, content]);
    }
    const original = rows(db, "SELECT * FROM task_states ORDER BY rowid")[0];
    await writeFile(path, db.export()); db.close();
    const migrated = new SqliteStore(path);
    await migrated.initialize(); await migrated.close();
    const rerun = new SqliteStore(path);
    await rerun.initialize(); await rerun.close();
    db = new SQL.Database(await readFile(path));
    assert.deepEqual(rows(db, "SELECT id FROM task_states"), [{ id: newest }]);
    const archive = rows(db, "SELECT * FROM task_state_migration_archive");
    assert.equal(archive.length, 1);
    assert.equal(archive[0].reason, "am023_duplicate");
    assert.ok(archive[0].archived_at);
    const record = JSON.parse(String(archive[0].record));
    assert.deepEqual(record, original, "every original column survives rerun, including unknown legacy fields");
    db.run("CREATE TABLE restored_tasks AS SELECT * FROM task_states WHERE 0");
    const columns = Object.keys(record);
    db.run(`INSERT INTO restored_tasks (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, Object.values(record) as Array<string | number | null>);
    assert.deepEqual(rows(db, "SELECT * FROM restored_tasks"), [original], "restore complete history in the isolated copy");
    assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE name = '_fts5_probe'").length, 0);
    // Deliberate archive conflict: migration must fail without losing the source.
    db.run("DROP INDEX uq_task_states_agent_task_id");
    db.run(`INSERT INTO task_states (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, Object.values(record) as Array<string | number | null>);
    // The newly inserted row wins SQLite rowid order; conflict its displaced predecessor.
    db.run("INSERT INTO task_state_migration_archive VALUES (?, '{}', '2026-01-01', 'collision fixture')", [newest]);
    const before = rows(db, "SELECT * FROM task_states ORDER BY id");
    await writeFile(path, db.export()); db.close();
    const failed = new SqliteStore(path);
    try { await assert.rejects(failed.initialize(), /UNIQUE/); }
    finally { await failed.close(); }
    db = new SQL.Database(await readFile(path));
    assert.deepEqual(rows(db, "SELECT * FROM task_states ORDER BY id"), before, "archive failure rolls back removal");
    assert.equal(rows(db, "SELECT * FROM task_state_migration_archive").length, 2);
    db.close();
    console.log("SQLite task migration: full retention, rerun, isolated restore and rollback PASS");
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function testPgTaskMigrationRetention(databaseUrl: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const schema = `retention_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(databaseUrl); scoped.searchParams.set("options", `-c search_path=${schema},public`);
  const store = new PgStore(scoped.toString());
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await store.initialize();
    await admin.query(`DROP INDEX ${schema}.uq_task_states_agent_task_id`);
    await admin.query(`ALTER TABLE ${schema}.task_states ADD COLUMN legacy_extra TEXT`);
    const id = randomUUID(), newest = randomUUID();
    const vector = JSON.stringify(Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0));
    for (const [key, time, content] of [[id, '2026-01-01', 'old full history'], [newest, '2026-01-02', 'latest']]) {
      await admin.query(`INSERT INTO ${schema}.task_states (id,agent_id,project,task,task_id,status,progress,files_modified,next_steps,created_at,updated_at,embedding,legacy_extra)
        VALUES ($1,'retention-seat','alpha','task','task','in_progress',$2,ARRAY['a.ts'],'continue',$3,$3,$4,'unknown retained column')`, [key, content, time, vector]);
    }
    const original = (await admin.query(`SELECT to_jsonb(t) AS record FROM ${schema}.task_states t WHERE id=$1`, [id])).rows[0].record;
    await store.initialize(); await store.initialize();
    assert.deepEqual((await admin.query(`SELECT id FROM ${schema}.task_states`)).rows, [{ id: newest }]);
    const archive = (await admin.query(`SELECT * FROM ${schema}.task_state_migration_archive`)).rows;
    assert.equal(archive.length, 1);
    assert.equal(archive[0].reason, "am023_duplicate"); assert.ok(archive[0].archived_at);
    assert.deepEqual(archive[0].record, original);
    await admin.query(`CREATE TABLE ${schema}.restored_tasks (LIKE ${schema}.task_states)`);
    await admin.query(`INSERT INTO ${schema}.restored_tasks SELECT (jsonb_populate_record(NULL::${schema}.task_states, record)).* FROM ${schema}.task_state_migration_archive`);
    assert.deepEqual((await admin.query(`SELECT to_jsonb(t) AS record FROM ${schema}.restored_tasks t`)).rows, [{ record: original }]);
    await admin.query(`DROP INDEX ${schema}.uq_task_states_agent_task_id`);
    await admin.query(`INSERT INTO ${schema}.task_states SELECT * FROM ${schema}.restored_tasks`);
    const before = (await admin.query(`SELECT to_jsonb(t) AS record FROM ${schema}.task_states t ORDER BY id`)).rows;
    await assert.rejects(store.initialize(), /duplicate key/);
    assert.deepEqual((await admin.query(`SELECT to_jsonb(t) AS record FROM ${schema}.task_states t ORDER BY id`)).rows, before, "archive collision rolls back the entire move");
    assert.deepEqual((await admin.query(`SELECT record FROM ${schema}.task_state_migration_archive`)).rows, [{ record: original }]);
    console.log("PostgreSQL task migration: full retention, rerun, isolated restore and rollback PASS");
  } finally {
    await store.close();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
  }
}
