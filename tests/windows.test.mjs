import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, copyFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { BACKENDS, configuration } from '../src/backends.mjs';
import { withPath } from '../src/settings.mjs';
import { Jobs } from '../src/jobs.mjs';

if (process.platform === 'win32') {
async function fixture(t, backend) {
  const root = await mkdtemp(join(tmpdir(), 'reasonix Windows 空格 & test-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const configDir = join(home, '.reasonix/native-subagents');
  await mkdir(bin, { recursive: true });
  await mkdir(configDir, { recursive: true });
  const executable = join(bin, backend.command + '.cmd');
  await copyFile(resolve('tests/fixture.mjs'), join(bin, 'fixture.mjs'));
  await writeFile(executable, `@echo off\r\n"${process.execPath}" "%~dp0fixture.mjs" %*\r\n`);
  const config = JSON.stringify({ schemaVersion: 1, [backend.command]: {
    permissionMode: backend.command === 'codex' ? 'workspace-write' : 'acceptEdits', timeoutSeconds: 15,
  }, future: 'keep' });
  await writeFile(join(configDir, 'config.json'), config);
  const env = withPath({ ...process.env, USERPROFILE: home, REASONIX_SUBAGENT_CONFIG_DIR: configDir }, bin);
  for (const key of ['REASONIX_CODEX_BIN', 'REASONIX_CLAUDE_BIN', 'REASONIX_SUBAGENT_NODE']) delete env[key];
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return { root, home, bin, env, executable, configDir, config };
}
async function run(jobs, task) {
  let result = await jobs.call({ action: 'start', task });
  while (['running', 'cancelling'].includes(result.status)) result = await jobs.call({ action: 'status', job_id: result.job_id, wait_seconds: 5 });
  return result;
}
async function ready(root, file) {
  for (let i = 0; i < 200; i++) {
    try { return Number(await readFile(join(root, file), 'utf8')); } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Fixture failed to start');
}
async function stopped(pid) {
  for (let i = 0; i < 200; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Windows process ${pid} survived cancellation`);
}

for (const backend of Object.values(BACKENDS)) {
  test(`${backend.name}: Windows .cmd discovery, literal arguments/stdin and actual edit/result`, { timeout: 30000 }, async t => {
    const f = await fixture(t, backend);
    const model = 'model & | %PATH% !bang! "quoted" 你好';
    const jobs = new Jobs(backend, f.root, { ...f.env, [`${backend.prefix}_MODEL`]: model });
    t.after(() => jobs.dispose());
    const c = configuration(backend, f.env);
    assert.equal(c.command, f.executable);
    assert.equal(c.mode, backend.command === 'codex' ? 'workspace-write' : 'acceptEdits');
    const literal = '中文 & | > < ^ %PATH% !x! "quoted" $(touch BAD)\nsecond line';
    assert.equal((await run(jobs, literal)).answer, literal);
    const inspected = JSON.parse((await run(jobs, 'inspect')).answer);
    assert.equal(await realpath(inspected.cwd), await realpath(f.root));
    assert.equal(inspected.argv[inspected.argv.indexOf('--model') + 1], model);
    if (backend.command === 'codex') assert.ok(inspected.argv.includes('approval_policy="never"'));
    await writeFile(join(f.root, 'answer.mjs'), 'export const answer = 0;\n');
    await writeFile(join(f.root, 'answer.test.mjs'), "import {answer} from './answer.mjs'; if(answer!==42) throw Error('wrong answer');\n");
    assert.equal((await run(jobs, 'edit-fixture')).status, 'completed');
    assert.match(await readFile(join(f.root, 'answer.mjs'), 'utf8'), /42/);
    execFileSync(process.execPath, ['answer.test.mjs'], { cwd: f.root });
    assert.equal(await readFile(join(f.configDir, 'config.json'), 'utf8'), f.config);
    const invalid = await jobs.call({ action: 'start', task: 'hi', cwd: '..' }).then(() => null, e => e);
    assert.match(invalid.message, /cwd_outside_workspace/);
  });
  test(`${backend.name}: Windows invalid results, missing CLI, immediate cancel and external config errors`, { timeout: 30000 }, async t => {
    const f = await fixture(t, backend);
    const jobs = new Jobs(backend, f.root, f.env);
    t.after(() => jobs.dispose());
    for (const [task, expected] of [['malformed', 'invalid_output'], ['fail', 'native_task_failed'], ['incomplete', 'incomplete_result']]) {
      assert.equal((await run(jobs, task)).error, expected);
    }
    for (let n = 0; n < 5; n++) {
      const start = await jobs.call({ action: 'start', task: 'hang' });
      assert.equal((await jobs.call({ action: 'cancel', job_id: start.job_id })).status, 'cancelled');
    }
    const missing = new Jobs(backend, f.root, { ...f.env, [`${backend.prefix}_BIN`]: join(f.root, 'missing.exe') });
    t.after(() => missing.dispose());
    assert.equal((await run(missing, 'hi')).error, 'executable_not_found');
    await writeFile(join(f.configDir, 'config.json'), '{broken');
    await assert.rejects(jobs.call({ action: 'start', task: 'hi' }), /config_unreadable_or_invalid/);
  });
  for (const operation of ['cancel', 'timeout', 'shutdown']) {
    test(`${backend.name}: Windows Job Object ${operation} stops detached tree, preserves unrelated process`, { timeout: 25000 }, async t => {
      const f = await fixture(t, backend);
      const jobs = new Jobs(backend, f.root, { ...f.env, [`${backend.prefix}_TIMEOUT_SECONDS`]: operation === 'timeout' ? '3' : '15' });
      t.after(() => jobs.dispose());
      const canary = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      t.after(() => canary.kill());
      const start = await jobs.call({ action: 'start', task: 'detached-descendant' });
      const pid = await ready(f.root, 'descendant.pid');
      t.after(() => { try { process.kill(pid); } catch {} });
      if (operation === 'cancel') assert.equal((await jobs.call({ action: 'cancel', job_id: start.job_id })).status, 'cancelled');
      else if (operation === 'shutdown') await jobs.dispose();
      else assert.equal((await jobs.call({ action: 'status', job_id: start.job_id, wait_seconds: 10 })).status, 'timed_out');
      await stopped(pid);
      assert.doesNotThrow(() => process.kill(canary.pid, 0));
    });
  }
  test(`${backend.name}: Windows copied package bootstraps Node without PATH and dies with its whole tree`, { timeout: 30000 }, async t => {
    const f = await fixture(t, backend);
    const nodeDir = join(f.home, 'AppData/Roaming/fnm/node-versions/v99.0.0/installation');
    await mkdir(nodeDir, { recursive: true });
    await copyFile(process.execPath, join(nodeDir, 'node.exe'));
    const target = join(f.root, 'package');
    await cp(resolve('packages', backend.name), target, { recursive: true });
    await rm(target, { recursive: true });
    await cp(resolve('packages', backend.name), target, { recursive: true });
    const child = spawn(join(target, 'runtime/launch.exe'), [], { cwd: f.root,
      env: { ...f.env, APPDATA: join(f.home, 'AppData/Roaming'), FNM_DIR: join(f.home, 'AppData/Roaming/fnm'),
        ProgramFiles: '', ProgramW6432: '', LOCALAPPDATA: '', NVM_SYMLINK: '', NVM_HOME: '' },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => child.kill());
    const pending = new Map(); let id = 0; let stderr = '';
    child.stderr.on('data', b => { stderr += b; });
    createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line); pending.get(frame.id)?.resolve(frame); pending.delete(frame.id);
    });
    child.on('error', e => { for (const p of pending.values()) p.reject(e); pending.clear(); });
    child.on('close', code => { for (const p of pending.values()) p.reject(new Error(`sidecar exited ${code}: ${stderr}`)); pending.clear(); });
    const request = (method, params = {}) => {
      const key = ++id;
      const promise = new Promise((resolve, reject) => pending.set(key, { resolve, reject }));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params })+'\n'); return promise;
    };
    const init = await request('extension/initialize', { protocolId: 'reasonix.extension.v2', protocolVersion: '2',
      manifest: { tools: [backend.tool] }, session: { workspaceRoot: f.root } });
    assert.equal(init.result.version, '0.1.3');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'extension/initialized' })+'\n');
    const call = async args => JSON.parse((await request('extension/tool/call', { name: backend.tool, arguments: args })).result.content);
    const start = await call({ action: 'start', task: 'detached-descendant' });
    assert.equal(start.status, 'running');
    const pid = await ready(f.root, 'descendant.pid');
    const exit = once(child, 'close'); child.kill('SIGKILL'); await exit;
    await stopped(pid);
    assert.equal(await readFile(join(f.configDir, 'config.json'), 'utf8'), f.config);
  });
}
}
