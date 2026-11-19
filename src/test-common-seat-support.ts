/**
 * What the common-infrastructure seat tests share (u1-seat-memory-skeleton, PR-1): synthetic seat settings, a fake SQL
 * window that stands in for the database (so the tests run without PostgreSQL and from CI), and small file helpers.
 * It holds no test. The fake keeps a decision list, can persist it to a file so a second process sees what the first
 * wrote, applies a write only when its transaction commits, and can be told to fail in the ways a real window fails.
 * Every id, name and password in it is synthetic; none is a real seat, URL or key.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqlClient, SqlConnection } from "./common-seat-store.js";

export const SECRET_PASSWORD = "PW-SYNTHETIC-4d7b";
export const SYNTHETIC_URL = `postgres://seat_user:${SECRET_PASSWORD}@127.0.0.1:1/memory`;
export const DECISION_TEXT = "DECISION-TEXT-SYNTHETIC-9c1e: keep the seat memory in the common database";

export interface SeatFixture {
  readonly installation_id: string;
  readonly db_epoch: string;
  readonly scope_id: string;
  readonly principal_id: string;
  readonly principal_revision: number;
  readonly membership_revision: number;
  readonly seat_id: string;
  readonly binding_id: string;
  readonly binding_generation: number;
}

/** Every id is the shape a seat setting needs (a version-4 id) with a fixed marker prefix no generated id has: a value that is plainly made up. */
const marked = (tail: string): string => `0badc0de-0000-4000-8000-0000000000${tail}`;
const base = {
  installation_id: marked("01"),
  db_epoch: marked("02"),
  scope_id: marked("03"),
  principal_id: marked("05"),
  principal_revision: 1,
  membership_revision: 1,
  binding_generation: 1,
} as const;

export const SEAT_A: SeatFixture = { ...base, seat_id: marked("a1"), binding_id: marked("a2") };
export const SEAT_B: SeatFixture = { ...base, seat_id: marked("b1"), binding_id: marked("b2") };
export const SEAT_UNREGISTERED: SeatFixture = { ...base, seat_id: marked("c1"), binding_id: marked("c2") };
export const syntheticId = marked;

export const dbError = (code: string, message: string): Error => Object.assign(new Error(message), { code });
export const networkError = (code?: string): Error => Object.assign(new Error("synthetic network failure"), code ? { code } : {});

export interface FakeDecision {
  id: string;
  scope_id: string;
  seat_ref: string;
  decision_text: string;
  context_text: string | null;
  project_name: string | null;
  tags: string[];
  status: string;
  created_at_ms: number;
}

export interface FakeFaults {
  connect?: Error;
  /** The next function call fails with this error (the transaction rolls back). */
  select?: Error;
  /** The next function call never answers. */
  hangSelect?: boolean;
  /** The next COMMIT fails like a lost connection; `applied` says whether the database kept the write. */
  commit?: { error: Error; applied: boolean };
  /** The next statement before the function call fails (BEGIN or SET LOCAL). */
  before?: Error;
}

export const FAKE_OBSERVED_AT_MS = 1_800_000_000_000;

export class FakeDb implements SqlClient {
  readonly statements: Array<{ text: string; values: readonly unknown[] }> = [];
  connects = 0;
  ended = 0;
  faults: FakeFaults = {};

  constructor(private readonly options: { seats?: readonly SeatFixture[]; stateFile?: string } = {}) {}

  get seats(): readonly SeatFixture[] {
    return this.options.seats ?? [SEAT_A, SEAT_B];
  }

  decisions(): FakeDecision[] {
    const file = this.options.stateFile;
    return file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as FakeDecision[]) : this.memory;
  }

  private memory: FakeDecision[] = [];

  private save(list: FakeDecision[]): void {
    if (this.options.stateFile) writeFileSync(this.options.stateFile, JSON.stringify(list));
    else this.memory = list;
  }

  async connect(_timeoutMs: number): Promise<SqlConnection> {
    this.connects += 1;
    if (this.faults.connect) throw this.faults.connect;
    let pending: FakeDecision[] | null = null;
    const self = this;
    return {
      async query(text: string, values: readonly unknown[]) {
        self.statements.push({ text, values });
        const fn = /SELECT kusabi\.(log_decision|get_decisions|recover_decisions)\(/.exec(text)?.[1];
        if (!fn) {
          if (self.faults.before && /^(BEGIN|SET LOCAL)/.test(text)) {
            const error = self.faults.before;
            self.faults.before = undefined;
            throw error;
          }
          if (text === "COMMIT") {
            const lost = self.faults.commit;
            self.faults.commit = undefined;
            if (lost) {
              if (lost.applied && pending) self.save(pending);
              pending = null;
              throw lost.error;
            }
            if (pending) self.save(pending);
          }
          if (text === "ROLLBACK") pending = null;
          return { rows: [] };
        }
        if (self.faults.hangSelect) {
          self.faults.hangSelect = false;
          return new Promise<never>(() => undefined);
        }
        if (self.faults.select) {
          const error = self.faults.select;
          self.faults.select = undefined;
          throw error;
        }
        const actor = self.verify(values);
        const current = pending ?? self.decisions();
        if (fn === "log_decision") {
          if (current.some((row) => row.id === values[3])) throw dbError("23505", `duplicate key value violates unique constraint "pk_decision"`);
          const row: FakeDecision = {
            id: String(values[3]),
            scope_id: actor.scope_id,
            seat_ref: actor.seat_id,
            decision_text: String(values[4]),
            context_text: (values[5] as string | null) ?? null,
            project_name: (values[6] as string | null) ?? null,
            tags: [...(values[8] as string[])].sort(),
            status: "active",
            created_at_ms: actor.observed_at_ms,
          };
          pending = [...current, row];
          return { rows: [{ result: { decision_id: row.id, created_at_ms: row.created_at_ms } }] };
        }
        const own = current
          .filter((row) => row.scope_id === actor.scope_id && row.seat_ref === actor.seat_id && row.status === "active")
          .sort((a, b) => b.created_at_ms - a.created_at_ms || (a.id < b.id ? 1 : -1));
        const verified = {
          scope_id: actor.scope_id,
          principal_ref: actor.principal_id,
          seat_ref: actor.seat_id,
          binding_ref: actor.binding_id,
          binding_generation: actor.binding_generation,
        };
        if (fn === "recover_decisions") {
          const limit = values[3] as number;
          return { rows: [{ result: { decisions: own.slice(0, limit), total_active_count: own.length, verified } }] };
        }
        const [, , , project, tags, limit] = values as [unknown, unknown, unknown, string | null, string[] | null, number];
        const wanted = own.filter(
          (row) => (project == null || row.project_name === project) && (!tags || tags.length === 0 || tags.some((t) => row.tags.includes(t))),
        );
        return { rows: [{ result: { decisions: wanted.slice(0, limit), verified } }] };
      },
      async end() {
        self.ended += 1;
      },
    };
  }

  /** The verification a fake database does: the setting must name a seat the fake knows. */
  private verify(values: readonly unknown[]) {
    const expected = JSON.parse(String(values[2])) as Record<string, unknown>;
    const seat = this.seats.find((s) => s.seat_id === expected.seat_id && s.binding_id === expected.binding_id && s.scope_id === values[1]);
    if (!seat) throw dbError("OC004", "onza-common:not_found");
    this.tick += 1;
    return { ...seat, observed_at_ms: FAKE_OBSERVED_AT_MS + this.tick };
  }

  private tick = 0;
}

/** A throwaway folder (name: letters, digits and '-' only) for one test; `remove` deletes it. */
export function scratchFolder(): { dir: string; remove: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "common-seat-")));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeConfig(dir: string, content: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

/** Every file under `dir` with its size, sorted: two snapshots that are equal mean nothing was written. */
export function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else out.push(`${path}:${info.size}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

export const settingFor = (seat: SeatFixture): Record<string, unknown> => ({ common_seat: { ...seat } });
