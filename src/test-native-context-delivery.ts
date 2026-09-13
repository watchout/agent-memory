import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteStore } from './stores/sqlite-store.js';
import { lookupNativeContextDelivery, observeNativeProcess, observeNativeProvider, type NativeContextDelivery, type NativeAttempt } from './native-context-delivery.js';
import { buildKusabiSessionStartRuntimeEvent, type KusabiRuntimeEventTargetBinding, type KusabiSessionStartEvidence } from './kusabi-runtime-event-emitter.js';
import { ingestKusabiRuntimeEvent, kusabiRuntimeEventSha256 } from './kusabi-runtime-event-store.js';
import { parseClaudeSessionStartInput } from './claude-session-start.js';
const h = (text: string) => createHash('sha256').update(text).digest('hex');
const childProgram = `
import { beginNativeContextAttempt, nativeAttemptSeed, observeNativeProcess, writeNativeContextResult } from './dist/native-context-delivery.js';
import { runCodexSessionStart, resolveCodexStoreBinding } from './dist/codex-session-start.js';
import { runClaudeSessionStart } from './dist/claude-session-start.js';
const runtime = process.env.FIXTURE_RUNTIME;
const binding = { agent_id: 'seat-continuity-fixture', project: 'product-fixture', workspace: process.env.FIXTURE_WORKSPACE,
 binding_source_ref: 'fixture:trusted-invocation', max_tokens: 1800, max_bytes: 8192, timeout_ms: 5000 };
const raw = JSON.stringify({ session_id: process.env.FIXTURE_SESSION, transcript_path: '/missing/fixture.jsonl', cwd: binding.workspace,
 hook_event_name: 'SessionStart', model: 'fixture', permission_mode: 'default', source: 'startup' });
const observe = () => observeNativeProcess(process.ppid);
const seed = nativeAttemptSeed({binding, rawInput:raw, runtime, storeBinding:resolveCodexStoreBinding(), adapter:{id:'native-pipe-fixture',version:'1.0.1'}});
const target = {schema_version:'kusabi-runtime-event-target/v1',manifest_id:'native-pipe-fixture',build:{commit_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),artifact_sha256:'c'.repeat(64)},configuration:{config_sha256:'d'.repeat(64),trust_fingerprint_sha256:'e'.repeat(64)},storage:{backend:'sqlite',binding_sha256:seed.store_binding.binding_sha256}};
const handle = await beginNativeContextAttempt({ evidence:seed, runtime, observeAncestor:observe, emission:{target, timeoutMs:5000} });
const result = await (runtime==='claude'?runClaudeSessionStart:runCodexSessionStart)(raw,binding);
const receipt = await writeNativeContextResult({result, runtime, handle, observeProvider:observe});
process.stderr.write(JSON.stringify({receipt, attempt:handle?.attempt, evidence:result.evidence, work:result.native_work_digest})+'\\n');
`;
async function runNative(env: Record<string,string>, closeReader = false) {
  return await new Promise<{output:string; report:any; code:number|null}>((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import','tsx','--input-type=module','-e',childProgram], { cwd:resolve('.'), env, stdio:['ignore','pipe','pipe'] });
    let output = ''; let stderr = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    if (closeReader) child.stdout.destroy();
    const timeout = setTimeout(() => { child.kill(); reject(new Error('native fixture timeout')); }, 15_000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); const lines=stderr.trim().split('\n');
      const line=lines.findLast(value=>value.startsWith('{') && value.includes('"receipt"'));
      if (!line) return reject(new Error(`native fixture failed ${code}: ${stderr.slice(-1500)}`));
      resolveRun({output, report:JSON.parse(line), code}); });
  });
}
async function registeredToolReadback(env: Record<string,string>, args: Record<string,unknown>) {
  const program = `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { registerNativeContextDeliveryTool, observeNativeProcess } from './dist/native-context-delivery.js';
    import { SqliteStore } from './dist/stores/sqlite-store.js';
    const store=new SqliteStore(process.env.AGENT_MEMORY_DB_PATH);await store.initialize();
    const server=new McpServer({name:'native-boundary-fixture',version:'1'});
    registerNativeContextDeliveryTool(server,store,process.env.AGENT_MEMORY_AGENT_ID,()=>observeNativeProcess(process.ppid));
    await server.connect(new StdioServerTransport());
  `;
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','--input-type=module','-e',program],cwd:resolve('.'),env,stderr:'pipe'});
  const client=new Client({name:'native-receipt-boundary',version:'1'});transport.stderr?.on('data',()=>{});
  try { await client.connect(transport); const tools=await client.listTools();assert(tools.tools.some(t=>t.name==='native_context_delivery'));
    const result=await client.callTool({name:'native_context_delivery',arguments:args});assert(!result.isError);
    return JSON.parse((result.content as Array<{text:string}>)[0].text);
  } finally {await client.close();}
}
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(),'native-seat-context-')));
  const dbPath = join(root,'one-store.db');
  const agent='seat-continuity-fixture', project='product-fixture';
  const objective='OWNER VERBATIM: preserve unfinished seat work';
  const next='Next action stays attached to this seat';
  let checks=0;
  try {
    const seed=new SqliteStore(dbPath); await seed.initialize();
    for(const [seat,proj,text] of [[agent,project,objective],['decoy-agent',project,'FOREIGN_AGENT_SENTINEL'],[agent,'decoy-project','FOREIGN_PROJECT_SENTINEL']]) {
      await seed.saveTaskState({agent_id:seat,project:proj,task:text,status:'in_progress',progress:'checkpoint 3',next_steps:next});
      await seed.logDecision({agent_id:seat,project:proj,decision:'Published fixture decision ref https://example.invalid/issue#decision; effects completed and unknown must not replay'});
    }
    await seed.close();
    const receipts: NativeContextDelivery[]=[];
    for(const [index,runtime] of ['codex','claude','codex'].entries()) {
      const workspace=join(root,`relocated-basename-${index}`); await mkdir(workspace);
      const result=await runNative({PATH:process.env.PATH??'',HOME:root,AGENT_MEMORY_DB_TYPE:'sqlite',AGENT_MEMORY_DB_PATH:dbPath,
        AGENT_MEMORY_AGENT_ID:agent,AGENT_MEMORY_PROJECT:project,FIXTURE_RUNTIME:runtime,FIXTURE_WORKSPACE:workspace,FIXTURE_SESSION:`native-session-${index}`});
      assert.equal(result.code,0); const output=JSON.parse(result.output);
      assert(output.hookSpecificOutput.additionalContext.includes(objective)); assert(output.hookSpecificOutput.additionalContext.includes(next));
      assert(!result.output.includes('FOREIGN_AGENT_SENTINEL')); assert(!result.output.includes('FOREIGN_PROJECT_SENTINEL'));
      assert(result.report.receipt,JSON.stringify(result.report));
      const receipt=result.report.receipt as NativeContextDelivery;
      assert.equal(receipt.input_sha256,h(result.output)); assert.equal(receipt.workspace_sha256,h(workspace));
      assert.equal(receipt.provider_pid,process.pid); receipts.push(receipt); checks+=8;
      const store=new SqliteStore(dbPath); await store.initialize();
      const lookup=await lookupNativeContextDelivery(store,agent,{project,target_runtime:runtime as 'codex'|'claude',provider_pid:process.pid,
        provider_started_at:receipt.provider_started_at,workspace_sha256:h(workspace),host_session_id:receipt.host_session_id},()=>observeNativeProcess(process.pid));
      assert.deepEqual(lookup,receipt); checks++;
      const mcpArgs={project,target_runtime:runtime,provider_pid:process.pid,provider_started_at:receipt.provider_started_at,workspace_sha256:h(workspace),host_session_id:receipt.host_session_id};
      const mcpEnv={PATH:process.env.PATH??'',HOME:root,AGENT_MEMORY_DB_PATH:dbPath,AGENT_MEMORY_AGENT_ID:agent};
      assert.deepEqual(await registeredToolReadback(mcpEnv,mcpArgs),receipt); checks++;
      assert.equal((await registeredToolReadback({...mcpEnv,AGENT_MEMORY_AGENT_ID:'decoy-agent'},mcpArgs)).status,'unavailable'); checks++;

      const rows=await store.getKusabiRuntimeEvents({target_key:h([agent,project,runtime==='claude'?'claude_code':'codex',h(workspace)].join('\n')),event_type:'session_start',limit:20});
      assert.equal(rows.length,2); assert.equal(rows.filter(r=>r.event.native_context_delivery).length,1);
      const start=rows.find(r=>(r.event.native_context_attempt as NativeAttempt).phase==='started')!;
      assert(!start.event.native_context_delivery); checks+=3;
      await store.close();
    }
    assert.equal(new Set(receipts.map(r=>r.work_sha256)).size,1); checks++;
    // Real OS stdout with no reader cannot produce an accepted receipt.
    const workspace=join(root,'broken-reader'); await mkdir(workspace);
    const failed=await runNative({PATH:process.env.PATH??'',HOME:root,AGENT_MEMORY_DB_TYPE:'sqlite',AGENT_MEMORY_DB_PATH:dbPath,
      AGENT_MEMORY_AGENT_ID:agent,AGENT_MEMORY_PROJECT:project,FIXTURE_RUNTIME:'codex',FIXTURE_WORKSPACE:workspace,FIXTURE_SESSION:'broken'},true);
    assert.equal(failed.report.receipt,null); checks++;
    // A Node test parent is never recognized as a production Codex/Claude provider.
    assert.throws(()=>observeNativeProvider(process.pid,'codex'),/NATIVE_PROVIDER_UNVERIFIED/); checks++;
    const latest=receipts[2]; const store=new SqliteStore(dbPath); await store.initialize();
    const input={project,target_runtime:'codex' as const,provider_pid:process.pid,provider_started_at:latest.provider_started_at,
      workspace_sha256:latest.workspace_sha256,host_session_id:latest.host_session_id};
    const baseRows=await store.getKusabiRuntimeEvents({target_key:h([agent,project,'codex',latest.workspace_sha256].join('\n')),event_type:'session_start',limit:20});
    const newer=structuredClone(baseRows.find(r=>(r.event.native_context_attempt as NativeAttempt).phase==='started')!.event);
    const a=newer.native_context_attempt as NativeAttempt; a.attempt_id='22222222-2222-4222-8222-222222222222';
    a.attempt_started_at=new Date(Date.now()).toISOString(); newer.event_id='33333333-3333-4333-8333-333333333333';newer.occurred_at=a.attempt_started_at;
    await ingestKusabiRuntimeEvent(store,newer);
    assert.equal((await lookupNativeContextDelivery(store,agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable'); checks++;
    // Same-session failed terminal cannot restore the older success, irrespective of completion order.
    const terminal=structuredClone(newer); (terminal.native_context_attempt as NativeAttempt).phase='finished';terminal.event_id='44444444-4444-4444-8444-444444444444';
    await ingestKusabiRuntimeEvent(store,terminal);
    assert.equal((await lookupNativeContextDelivery(store,agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable'); checks++;
    const wrong={...input,provider_started_at:new Date(Date.parse(input.provider_started_at)-1000).toISOString()};
    assert.equal((await lookupNativeContextDelivery(store,agent,wrong,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    assert.equal((await lookupNativeContextDelivery(store,'decoy-agent',input,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    // A delayed older completion cannot outrank the latest source attempt.
    const oldFinish=structuredClone(baseRows.find(r=>r.event.native_context_delivery)!.event);
    oldFinish.occurred_at=new Date(Date.now()+1).toISOString();
    const projected=[...await store.getKusabiRuntimeEvents({target_key:newer.target_key,event_type:'session_start',limit:20})]
      .filter(row=>row.event_id!==oldFinish.event_id).concat([{event:oldFinish,event_sha256:kusabiRuntimeEventSha256(oldFinish)} as any]);
    assert.equal((await lookupNativeContextDelivery({getKusabiRuntimeEvents:async()=>projected},agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    const missing=structuredClone(newer);missing.event_id='55555555-5555-4555-8555-555555555555';
    const missingAttempt=missing.native_context_attempt as NativeAttempt;missingAttempt.attempt_id='66666666-6666-4666-8666-666666666666';
    missingAttempt.host_session_id=null;missingAttempt.attempt_started_at=new Date(Date.now()+2).toISOString();
    missing.occurred_at=missingAttempt.attempt_started_at;await ingestKusabiRuntimeEvent(store,missing);
    assert.equal((await lookupNativeContextDelivery(store,agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    const tied=structuredClone(missing);tied.event_id='77777777-7777-4777-8777-777777777777';
    (tied.native_context_attempt as NativeAttempt).attempt_id='88888888-8888-4888-8888-888888888888';await ingestKusabiRuntimeEvent(store,tied);
    assert.equal((await lookupNativeContextDelivery(store,agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    const validRecord=baseRows[0];assert.equal((await lookupNativeContextDelivery({getKusabiRuntimeEvents:async()=>Array(201).fill(validRecord)},agent,input,()=>observeNativeProcess(process.pid))).status,'unavailable');checks++;
    await store.close();
    for(const source of ['resume','fork']) {
      const parsed=parseClaudeSessionStartInput(JSON.stringify({session_id:'current',transcript_path:'/tmp/fixture',cwd:root,hook_event_name:'SessionStart',source,
        scratchpad_dir:'/tmp/scratch',session_title:'fixture',seconds_since_last_response:30,context_tokens:100,prompt_cache_likely_expired:false,estimated_cache_write_usd:0.01}));
      assert.equal(parsed.source,source);checks++;
    }
    console.log(JSON.stringify({status:'PASS',checks,native_input_protocols:['codex','claude','codex'],one_store:true,
      semantic_digest:receipts[0].work_sha256,input_digests:receipts.map(r=>r.input_sha256),provider_api_calls:0,
      observation_scope:'real OS peer pipe with independently read fixture parent process; provider classification injected only in test',
      live_application:false}));
  } finally { await rm(root,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
