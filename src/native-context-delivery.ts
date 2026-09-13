import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Writable } from 'node:stream';
import type { Store } from './stores/types.js';
import { validateKusabiRuntimeEvent, kusabiRuntimeEventSha256, canonicalKusabiRuntimeEvent } from './kusabi-runtime-event-store.js';
import { emitKusabiSessionStartRuntimeEvent, type KusabiSessionStartEvidence, type KusabiRuntimeEventEmissionOptions } from './kusabi-runtime-event-emitter.js';

export type NativeInvocationBinding = { schema_version: 'native-invocation-binding/v1'; verified: boolean; argv_sha256: string; binding_source_ref_sha256: string; workspace_sha256: string; configuration_sha256: null; trust_status: 'native-invocation-only' };
export type NativeRuntime = 'codex' | 'claude';
export type NativeAttempt = {
  schema_version: 'native-context-attempt/v1'; attempt_id: string; phase: 'started' | 'finished';
  attempt_started_at: string; hook_pid: number; hook_started_at: string;
  provider_pid: number; provider_started_at: string; host_session_id: string | null;
};
export type NativeContextDelivery = {
  schema_version: 'native-context-delivery/v1'; status: 'accepted'; agent_id: string; project: string;
  target_runtime: NativeRuntime; host_session_id: string; provider_pid: number; provider_started_at: string;
  provider_executable_sha256: string; workspace_sha256: string; pipe_sha256: string; input_sha256: string;
  work_sha256: string; pack_ref: string; delivered_at: string; attempt_id: string; attempt_started_at: string;
};
export type ProviderObservation = { pid: number; ppid: number; startedAt: string; executableDigest: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unavailable = (code: string) => ({ status: 'unavailable' as const, code });

function processTuple(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('NATIVE_PROCESS_UNVERIFIED');
  const output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,lstart='],
    { encoding: 'utf8', timeout: 1500, env: { ...process.env, LC_ALL: 'C' } }).trim();
  const match = output.match(/^(\d+)\s+(\d+)\s+(.{24})$/);
  if (!match || Number(match[1]) !== pid || !iso(match[3])) throw new Error('NATIVE_PROCESS_UNVERIFIED');
  const startTicks = process.platform === 'linux'
    ? readFileSync(`/proc/${pid}/stat`, 'utf8').split(/\)\s+/).at(-1)!.trim().split(/\s+/)[19] : null;
  if (process.platform === 'linux' && !/^\d+$/.test(startTicks ?? '')) throw new Error('NATIVE_PROCESS_UNVERIFIED');
  return { pid, ppid: Number(match[2]), startedAt: new Date(match[3]).toISOString(), startTicks };
}

// lsof's Darwin text mappings include libraries. Only a unique MH_EXECUTE
// mapping establishes the executable; neither its position nor its name does.
function isMachExecutable(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const read = (offset: number, length: number) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > size) throw new Error('MACH_HEADER_INVALID');
      const bytes = Buffer.alloc(length);
      if (readSync(fd!, bytes, 0, length, offset) !== length) throw new Error('MACH_HEADER_INVALID');
      return bytes;
    };
    const thin = (offset: number) => {
      const header = read(offset, 16);
      const magic = header.readUInt32LE(0);
      if ([0xfeedface, 0xfeedfacf].includes(magic)) return header.readUInt32LE(12) === 2;
      if ([0xcefaedfe, 0xcffaedfe].includes(magic)) return header.readUInt32BE(12) === 2;
      return false;
    };
    const header = read(0, 8); const magic = header.readUInt32BE(0);
    if (![0xcafebabe, 0xcafebabf].includes(magic)) return thin(0);
    const count = header.readUInt32BE(4); const width = magic === 0xcafebabf ? 32 : 20;
    if (count === 0 || count > 32) return false;
    return Array.from({ length: count }, (_, index) => {
      const arch = read(8 + index * width, width);
      return thin(width === 32 ? Number(arch.readBigUInt64BE(8)) : arch.readUInt32BE(8));
    }).every(Boolean);
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function kernelExecutable(pid: number): string {
  if (process.platform === 'linux') {
    const kernelPath = `/proc/${pid}/exe`;
    const executable = realpathSync(kernelPath);
    const mapped = statSync(kernelPath); const file = statSync(executable);
    if (mapped.dev !== file.dev || mapped.ino !== file.ino) throw new Error('NATIVE_EXECUTABLE_CHANGED');
    return executable;
  }
  if (process.platform !== 'darwin') throw new Error('NATIVE_PLATFORM_UNSUPPORTED');
  const raw = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-F', 'pfnDi'],
    { encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024 });
  const candidates = new Set<string>();
  for (const row of parseNativePipeSnapshot(raw)) {
    if (row.pid !== pid || row.fd !== 'txt' || !row.name?.startsWith('/') || !row.inode || !row.deviceNumber) continue;
    let executable: string;
    try { executable = realpathSync(row.name); } catch { continue; }
    if (!isMachExecutable(executable)) continue;
    const file = statSync(executable);
    if (String(file.ino) !== row.inode || BigInt(file.dev) !== BigInt(row.deviceNumber)) throw new Error('NATIVE_EXECUTABLE_CHANGED');
    candidates.add(executable);
  }
  if (candidates.size !== 1) throw new Error('NATIVE_EXECUTABLE_UNVERIFIED');
  return [...candidates][0];
}

export function observeNativeProcess(pid: number): ProviderObservation & { executable: string } {
  const before = processTuple(pid);
  const executable = kernelExecutable(pid);
  const info = statSync(executable);
  if (!info.isFile()) throw new Error('NATIVE_EXECUTABLE_UNVERIFIED');
  const after = processTuple(pid);
  if (JSON.stringify(before) !== JSON.stringify(after) || kernelExecutable(pid) !== executable) throw new Error('NATIVE_PROCESS_CHANGED');
  const current = statSync(executable);
  const fingerprint = (stat: typeof info) => JSON.stringify([executable, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.mode, before.startTicks]);
  if (fingerprint(info) !== fingerprint(current)) throw new Error('NATIVE_EXECUTABLE_CHANGED');
  return { pid, ppid: before.ppid, startedAt: before.startedAt, executable, executableDigest: hash(fingerprint(info)) };
}

/** Resolve the installed CLI, then verify the actual native executable belongs
 * to that installed package. An executable basename alone is never sufficient. */
function isInstalledProvider(executable: string, runtime: NativeRuntime): boolean {
  try {
    const entry = realpathSync(execFileSync('/usr/bin/which', [runtime], { encoding: 'utf8', timeout: 1500 }).trim());
    if (runtime === 'claude') return entry === executable;
    if (entry === executable) return true;
    let root = dirname(entry);
    for (let depth = 0; depth < 6; depth++, root = dirname(root)) {
      try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        if (pkg.name === '@openai/codex') {
          const rel = relative(root, executable);
          if (!rel.startsWith('..') && !rel.startsWith('/') && /(?:vendor|node_modules)\//.test(rel)) return true;
          // Codex's optional platform package is a sibling under the same @openai installation.
          const sibling = relative(dirname(root), executable);
          return /^codex-(?:darwin|linux|win32)-[^/]+\//.test(sibling);
        }
      } catch { /* walk to the installed package root */ }
    }
  } catch { /* missing CLI or process is unavailable, never guessed */ }
  return false;
}

export function observeNativeProvider(pid: number, runtime: NativeRuntime): ProviderObservation {
  const observed = observeNativeProcess(pid);
  if (!isInstalledProvider(observed.executable, runtime)) throw new Error('NATIVE_PROVIDER_UNVERIFIED');
  return observed;
}

export function observeNativeAncestor(runtime: NativeRuntime, hookPid = process.pid): ProviderObservation {
  const found: ProviderObservation[] = [];
  let pid = observeNativeProcess(hookPid).ppid;
  for (let depth = 0; pid > 1 && depth < 20; depth++) {
    const row = observeNativeProcess(pid);
    if (isInstalledProvider(row.executable, runtime)) found.push(row);
    pid = row.ppid;
  }
  if (found.length !== 1) throw new Error('NATIVE_PROVIDER_ANCESTRY_AMBIGUOUS');
  return found[0];
}

type Fd = { pid: number; fd: string; type?: string; device?: string; peer?: string;
  name?: string; inode?: string; deviceNumber?: string; access?: string; peers?: Array<{ pid: number; fd: string; access: string }> };
export function parseNativePipeSnapshot(raw: string): Fd[] {
  const rows: Fd[] = []; let pid = 0; let row: Fd | undefined;
  for (const line of raw.split('\n')) {
    if (line[0] === 'p') { pid = Number(line.slice(1)); row = undefined; }
    else if (line[0] === 'f') { row = { pid, fd: line.slice(1) }; rows.push(row); }
    else if (row && line[0] === 't') row.type = line.slice(1);
    else if (row && line[0] === 'd') row.device = line.slice(1);
    else if (row && line[0] === 'D') row.deviceNumber = line.slice(1);
    else if (row && line[0] === 'i') row.inode = line.slice(1);
    else if (row && line[0] === 'a') row.access = line.slice(1);
    else if (row && line[0] === 'n') {
      row.name = line.slice(1);
      row.peer = line.startsWith('n->') ? line.slice(3) : line.match(/->INO=(\d+)/)?.[1];
      row.peers = [...line.matchAll(/(?:^|\s)(\d+),[^\s,]+,(\d+)([rwu])(?=\s|$)/g)]
        .map(match => ({ pid: Number(match[1]), fd: match[2], access: match[3] }));
    }
  }
  return rows;
}

/** Exact reciprocal kernel endpoint, not merely stdout's pipe type. */
export function observeNativePipe(providerPid: number, hookPid = process.pid, fd = 1): string {
  if (hookPid !== process.pid || providerPid === hookPid) throw new Error('NATIVE_STDOUT_PEER_UNVERIFIED');
  const hookBefore = processTuple(hookPid); const providerBefore = processTuple(providerPid);
  const info = fstatSync(fd);
  if (!info.isFIFO() && !info.isSocket()) throw new Error('NATIVE_STDOUT_NOT_PIPE');
  const raw = execFileSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof',
    ['-nP', ...(process.platform === 'linux' ? ['-E'] : []), '-a', '-p', `${hookPid},${providerPid}`, '-F', 'pftdanDi'],
    { encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024 });
  const rows = parseNativePipeSnapshot(raw);
  const outputs = rows.filter(row => row.pid === hookPid && row.fd === String(fd));
  if (outputs.length !== 1) throw new Error('NATIVE_STDOUT_PEER_UNVERIFIED');
  const output = outputs[0];
  let peers: Fd[];
  if (process.platform === 'linux') {
    if (!output.inode || output.inode !== String(info.ino) || !['unix', 'FIFO'].includes(output.type ?? '')) throw new Error('NATIVE_STDOUT_PEER_UNVERIFIED');
    const links = output.peers ?? [];
    peers = rows.filter(row => row.pid === providerPid && row.type === output.type
      && links.length === 1 && links[0].pid === providerPid && links[0].fd === row.fd
      && row.peers?.length === 1 && row.peers[0].pid === hookPid && row.peers[0].fd === String(fd)
      && (output.type === 'unix'
        ? output.peer === row.inode && row.peer === output.inode
        : output.inode === row.inode && output.access === 'w' && row.access === 'r'));
  } else if (process.platform === 'darwin') {
    if (!output.device || !output.peer || !['PIPE', 'unix'].includes(output.type ?? '')) throw new Error('NATIVE_STDOUT_PEER_UNVERIFIED');
    peers = rows.filter(row => row.pid === providerPid && row.device === output.peer && row.peer === output.device);
  } else throw new Error('NATIVE_PLATFORM_UNSUPPORTED');
  if (peers.length !== 1) throw new Error('NATIVE_STDOUT_PEER_UNVERIFIED');
  const current = fstatSync(fd);
  if (JSON.stringify(hookBefore) !== JSON.stringify(processTuple(hookPid))
    || JSON.stringify(providerBefore) !== JSON.stringify(processTuple(providerPid))
    || current.dev !== info.dev || current.ino !== info.ino || current.mode !== info.mode) throw new Error('NATIVE_PROCESS_CHANGED');
  return hash(JSON.stringify([hookPid, fd, providerPid, peers[0].fd, output.device, output.inode, output.peer, info.dev, info.ino]));
}

export type NativeAttemptHandle = { attempt: NativeAttempt; observation: ProviderObservation; durable: boolean; emission: KusabiRuntimeEventEmissionOptions; invocation?: NativeInvocationBinding };
export async function beginNativeContextAttempt(input: {
  evidence: KusabiSessionStartEvidence; runtime: NativeRuntime; emission?: KusabiRuntimeEventEmissionOptions;
  observeAncestor?: typeof observeNativeAncestor; sourceStart?: number;
}): Promise<NativeAttemptHandle | null> {
  try {
    const observation = (input.observeAncestor ?? observeNativeAncestor)(input.runtime);
    const hook = observeNativeProcess(process.pid);
    const attempt: NativeAttempt = { schema_version: 'native-context-attempt/v1', attempt_id: randomUUID(), phase: 'started',
      attempt_started_at: new Date(input.sourceStart ?? performance.timeOrigin).toISOString(), hook_pid: process.pid,
      hook_started_at: hook.startedAt, provider_pid: observation.pid, provider_started_at: observation.startedAt,
      host_session_id: input.evidence.hook.session_id };
    const emission = input.emission ?? {};
    const result = await emitKusabiSessionStartRuntimeEvent({ ...input.evidence, native_context_attempt: attempt }, emission);
    return { attempt, observation, durable: result.status === 'durable', emission, invocation: input.evidence.native_invocation_binding };
  } catch { return null; }
}

export async function writeNativeContextResult(input: {
  result: { native_work_digest?: string; output: { hookSpecificOutput?: { additionalContext: string } };
    evidence: KusabiSessionStartEvidence & { identity: { verified?: boolean }; recovery_pack: { missing_context?: string[] } } };
  runtime: NativeRuntime; handle: NativeAttemptHandle | null; stdout?: Writable; emission?: KusabiRuntimeEventEmissionOptions;
  observeProvider?: typeof observeNativeProvider; observePipe?: typeof observeNativePipe;
}): Promise<NativeContextDelivery | null> {
  const { result, handle } = input;
  const bytes = `${JSON.stringify(result.output)}\n`;
  const stdout = input.stdout ?? process.stdout;
  let receipt: NativeContextDelivery | null = null;
  let pipe: string | undefined;
  const observe = input.observeProvider ?? observeNativeProvider;
  const pipeObserver = input.observePipe ?? observeNativePipe;
  const evidence = result.evidence;
  try {
    if (handle?.durable && evidence.outcome === 'full' && evidence.identity.verified === true
      && handle.attempt.host_session_id && evidence.hook.session_id === handle.attempt.host_session_id
      && evidence.recovery_pack.pack_ref?.startsWith(`restart_pack:${evidence.identity.agent_id}:${evidence.identity.project}:`)
      && !evidence.recovery_pack.missing_context?.some(item => ['active_task', 'next_action'].includes(item))
      && hex(result.native_work_digest) && result.output.hookSpecificOutput?.additionalContext) {
      const before = observe(handle.observation.pid, input.runtime);
      if (before.startedAt !== handle.observation.startedAt || before.executableDigest !== handle.observation.executableDigest) throw new Error('NATIVE_PROCESS_CHANGED');
      pipe = pipeObserver(before.pid);
    }
  } catch { pipe = undefined; }
  let written = false;
  try {
    await new Promise<void>((resolveWrite, reject) => {
      const cleanup = () => { setImmediate(() => stdout.off('error', fail)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('NATIVE_OUTPUT_TIMEOUT')); }, 2000);
      const fail = (error: Error) => { clearTimeout(timer); cleanup(); reject(error); };
      stdout.on('error', fail);
      stdout.write(bytes, error => { if (error) return fail(error); clearTimeout(timer); cleanup(); resolveWrite(); });
    });
    written = true;
    if (pipe && handle) {
      const after = observe(handle.observation.pid, input.runtime);
      if (after.startedAt !== handle.observation.startedAt || after.executableDigest !== handle.observation.executableDigest
        || pipeObserver(after.pid) !== pipe) throw new Error('NATIVE_PROCESS_CHANGED');
      receipt = { schema_version: 'native-context-delivery/v1', status: 'accepted', agent_id: evidence.identity.agent_id,
        project: evidence.identity.project, target_runtime: input.runtime, host_session_id: handle.attempt.host_session_id!,
        provider_pid: after.pid, provider_started_at: after.startedAt, provider_executable_sha256: after.executableDigest,
        workspace_sha256: evidence.identity.workspace_sha256, pipe_sha256: pipe, input_sha256: hash(bytes),
        work_sha256: result.native_work_digest!, pack_ref: evidence.recovery_pack.pack_ref!,
        delivered_at: new Date().toISOString(), attempt_id: handle.attempt.attempt_id, attempt_started_at: handle.attempt.attempt_started_at };
    }
  } catch { receipt = null; }
  if (handle) {
    if (handle.invocation) evidence.native_invocation_binding = handle.invocation;
    evidence.native_context_attempt = { ...handle.attempt, phase: 'finished' };
    if (receipt) evidence.native_context_delivery = receipt;
    const stored = await emitKusabiSessionStartRuntimeEvent(evidence, handle.emission);
    if (stored.status !== 'durable') receipt = null;
  } else {
    await emitKusabiSessionStartRuntimeEvent(evidence, input.emission);
  }
  if (!written) return null;
  return receipt;
}

export type NativeLookup = { project: string; target_runtime: NativeRuntime; provider_pid: number; provider_started_at: string;
  workspace_sha256: string; host_session_id?: string };
export async function lookupNativeContextDelivery(store: Pick<Store, 'getKusabiRuntimeEvents'>, agentId: string,
  input: NativeLookup, observe: typeof observeNativeProvider = observeNativeProvider): Promise<NativeContextDelivery | { status: 'unavailable'; code: string }> {
  try {
    if (!agentId || !input.project || !hex(input.workspace_sha256) || !iso(input.provider_started_at)) return unavailable('NATIVE_LOOKUP_IDENTITY_INVALID');
    const provider = observe(input.provider_pid, input.target_runtime);
    if (provider.startedAt !== input.provider_started_at) return unavailable('NATIVE_PROVIDER_CHANGED');
    const target = hash([agentId, input.project, input.target_runtime === 'claude' ? 'claude_code' : 'codex', input.workspace_sha256].join('\n'));
    const records = await store.getKusabiRuntimeEvents({ target_key: target, event_type: 'session_start', since: input.provider_started_at, limit: 201 });
    if (records.some(record => !validateKusabiRuntimeEvent(record.event).valid || kusabiRuntimeEventSha256(record.event) !== record.event_sha256)) return unavailable('NATIVE_STORED_EVENT_INVALID');
    const events = records.map(record => record.event);
    if (!events.length || events.length >= 201) return unavailable('NATIVE_HISTORY_MISSING_OR_TRUNCATED');
    const attempts = events.filter(event => {
      const a = event.native_context_attempt as NativeAttempt | undefined;
      return a && a.provider_pid === provider.pid && a.provider_started_at === provider.startedAt;
    });
    // Legacy or malformed events after provider startup cannot be silently ignored.
    if (events.some(event => !event.native_context_attempt)) return unavailable('NATIVE_ATTEMPT_UNVERIFIED');
    if (!attempts.length) return unavailable('NATIVE_ATTEMPT_MISSING');
    if (attempts.some(event => { const a = event.native_context_attempt as NativeAttempt; return a.phase === 'finished' && !attempts.some(start => { const b = start.native_context_attempt as NativeAttempt; return b.phase === 'started' && b.attempt_id === a.attempt_id && b.attempt_started_at === a.attempt_started_at; }); })) return unavailable('NATIVE_ATTEMPT_START_MISSING');
    const starts = attempts.filter(event => (event.native_context_attempt as NativeAttempt).phase === 'started');
    if (!starts.length) return unavailable('NATIVE_ATTEMPT_START_MISSING');
    const bySource = [...starts].sort((a,b) => Date.parse((b.native_context_attempt as NativeAttempt).attempt_started_at) - Date.parse((a.native_context_attempt as NativeAttempt).attempt_started_at));
    const current = bySource[0].native_context_attempt as NativeAttempt;
    if (!iso(current.attempt_started_at) || Date.parse(current.attempt_started_at) < Date.parse(provider.startedAt)
      || bySource.filter(e => (e.native_context_attempt as NativeAttempt).attempt_started_at === current.attempt_started_at).length !== 1) return unavailable('NATIVE_ATTEMPT_ORDER_AMBIGUOUS');
    const sessions = new Set(attempts.map(event => (event.native_context_attempt as NativeAttempt).host_session_id));
    if (!current.host_session_id || (input.host_session_id ? current.host_session_id !== input.host_session_id : sessions.size !== 1 || sessions.has(null))) return unavailable('NATIVE_SESSION_AMBIGUOUS');
    const terminals = attempts.filter(e => { const a = e.native_context_attempt as NativeAttempt; return a.phase === 'finished' && a.attempt_id === current.attempt_id && a.attempt_started_at === current.attempt_started_at; });
    if (terminals.length !== 1) return unavailable('NATIVE_LATEST_ATTEMPT_PENDING');
    const event = terminals[0]; const producer = event.producer as Record<string, unknown>; const receipt = event.native_context_delivery as NativeContextDelivery | undefined;
    if (!receipt || receipt.schema_version !== 'native-context-delivery/v1' || receipt.status !== 'accepted'
      || receipt.agent_id !== agentId || receipt.project !== input.project || receipt.target_runtime !== input.target_runtime
      || receipt.provider_pid !== provider.pid || receipt.provider_started_at !== provider.startedAt
      || receipt.provider_executable_sha256 !== provider.executableDigest || receipt.workspace_sha256 !== input.workspace_sha256
      || receipt.host_session_id !== current.host_session_id || receipt.attempt_id !== current.attempt_id || receipt.attempt_started_at !== current.attempt_started_at
      || ![receipt.pipe_sha256, receipt.input_sha256, receipt.work_sha256].every(hex) || !iso(receipt.delivered_at)
      || Date.parse(receipt.delivered_at) < Date.parse(current.attempt_started_at) || Date.parse(receipt.delivered_at) > Date.now()
      || !receipt.pack_ref.startsWith(`restart_pack:${agentId}:${input.project}:`)
      || producer.agent_id !== agentId || producer.project !== input.project || producer.workspace_sha256 !== input.workspace_sha256) return unavailable('NATIVE_LATEST_ATTEMPT_NOT_ACCEPTED');
    return receipt;
  } catch { return unavailable('NATIVE_LOOKUP_UNAVAILABLE'); }
}

export function nativeAttemptSeed(input: { binding: { agent_id: string; project: string; workspace: string; binding_source_ref: string };
  runtime: NativeRuntime; adapter: { id: string; version: string }; storeBinding: KusabiSessionStartEvidence['store_binding']; rawInput: string }): KusabiSessionStartEvidence {
  let session: string | null = null;
  try { const raw = JSON.parse(input.rawInput); if (typeof raw.session_id === 'string' && raw.session_id.trim()) session = raw.session_id; } catch { /* counted as missing-session attempt */ }
  const arg = (name: string) => { const positions = process.argv.map((value,index)=>value === name ? index : -1).filter(index=>index >= 0); return positions.length === 1 ? process.argv[positions[0]+1] : undefined; };
  const invocation: NativeInvocationBinding = { schema_version: 'native-invocation-binding/v1',
    verified: arg('--agent-id') === input.binding.agent_id && arg('--project') === input.binding.project
      && arg('--workspace') === input.binding.workspace && arg('--binding-source-ref') === input.binding.binding_source_ref,
    argv_sha256: hash(JSON.stringify(process.argv)), binding_source_ref_sha256: hash(input.binding.binding_source_ref),
    workspace_sha256: hash(input.binding.workspace), configuration_sha256: null, trust_status: 'native-invocation-only' };
  return { native_invocation_binding: invocation, adapter: input.adapter, identity: { agent_id: input.binding.agent_id, project: input.binding.project,
    workspace_sha256: hash(input.binding.workspace), binding_source_ref: input.binding.binding_source_ref,
    runtime: input.runtime === 'claude' ? 'claude-code' : 'codex' }, store_binding: input.storeBinding,
    hook: { session_id: session }, timing: { completed_at: new Date(performance.timeOrigin).toISOString(), elapsed_ms: 0 },
    output: { token_estimate: 0, redaction_count: 0 }, recovery_pack: { pack_ref: null, policy_version: null },
    outcome: 'degraded', degraded_reason: 'RECOVERY_UNAVAILABLE', recovery_quality_log_ref: null };
}


export function nativeWorkDigest(items: Array<{ item_id: string; kind: string; source_ref: string; summary: string }>): string | undefined {
  if (!items.some(item => item.kind === 'current_task' && /Next:\s*\S/.test(item.summary))) return undefined;
  return hash(canonicalKusabiRuntimeEvent(items.map(item => ({ id: item.item_id, kind: item.kind, source_ref: item.source_ref, summary: item.summary })).sort((a,b) => a.id.localeCompare(b.id))));
}


export function registerNativeContextDeliveryTool(server: McpServer, store: Pick<Store, 'getKusabiRuntimeEvents'>,
  agentId: string, observe: typeof observeNativeProvider = observeNativeProvider): void {
  server.tool('native_context_delivery',
    "Read the current native SessionStart input receipt for this server's seat. No context or task mutation.",
    { project: z.string(), target_runtime: z.enum(['codex','claude']), provider_pid: z.number().int().min(2),
      provider_started_at: z.string(), workspace_sha256: z.string().regex(/^[a-f0-9]{64}$/), host_session_id: z.string().optional() },
    async input => ({ content: [{ type: 'text', text: JSON.stringify(await lookupNativeContextDelivery(store, agentId, input, observe)) }] }),
  );
}
