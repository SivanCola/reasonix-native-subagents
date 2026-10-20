import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Jobs } from '../src/jobs.mjs';
import { BACKENDS, configuration, invocation } from '../src/backends.mjs';

const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
await chmod(fixture, 0o755);
async function setup(t, kind, override = {}) {
  const root = await mkdtemp(join(tmpdir(), 'native-subagent-test-'));
  const backend = BACKENDS[kind];
  const jobs = new Jobs(backend, root, {
    ...process.env, [`${backend.prefix}_BIN`]: fixture, [`${backend.prefix}_TIMEOUT_SECONDS`]: '10', ...override,
  });
  t.after(async () => { await jobs.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, jobs };
}
async function run(jobs, task) {
  let result = await jobs.call({ action: 'start', task });
  while (result.status === 'running') {
    result = await jobs.call({ action: 'status', job_id: result.job_id, wait_seconds: 5 });
  }
  return result;
}
for (const kind of Object.keys(BACKENDS)) {
  test(`${kind}: final result only, fresh task and literal stdin`, async t => {
    const { jobs } = await setup(t, kind);
    const text = '你好 $(touch NEVER) `echo bad` --model fake\nsecond line';
    assert.equal((await run(jobs, text)).answer, text);
    assert.equal((await run(jobs, 'next isolated task')).answer, 'next isolated task');
  });
  test(`${kind}: errors never expose native stderr or failure details`, async t => {
    const { jobs } = await setup(t, kind);
    const result = await run(jobs, 'fail');
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'native_task_failed');
    assert.ok(!JSON.stringify(result).includes('secret-token'));
  });
  test(`${kind}: long UTF-8 native records preserve NDJSON boundaries`, async t => {
    const { jobs } = await setup(t, kind);
    assert.equal((await run(jobs, 'large-record')).answer, 'large-record');
  });
  for (const [task, error] of [['malformed', 'invalid_output'], ['overflow', 'output_limit'],
    ['empty', 'empty_result'], ['incomplete', 'incomplete_result']]) {
    test(`${kind}: rejects ${task}`, async t => {
      const { jobs } = await setup(t, kind);
      assert.equal((await run(jobs, task)).error, error);
    });
  }
  test(`${kind}: concurrent start is rejected and cancellation is terminal`, async t => {
    const { jobs } = await setup(t, kind);
    const results = await Promise.allSettled([
      jobs.call({ action: 'start', task: 'hang' }), jobs.call({ action: 'start', task: 'hang' }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const id = results.find(r => r.status === 'fulfilled').value.job_id;
    assert.equal((await jobs.call({ action: 'cancel', job_id: id })).status, 'cancelled');
    assert.equal((await jobs.call({ action: 'status', job_id: id })).status, 'cancelled');
  });
  test(`${kind}: wall deadline terminates an uncooperative child`, async t => {
    const { jobs } = await setup(t, kind, { [`${BACKENDS[kind].prefix}_TIMEOUT_SECONDS`]: '1' });
    assert.equal((await run(jobs, 'hang')).status, 'timed_out');
  });
  test(`${kind}: missing CLI has actionable stable failure`, async t => {
    const { jobs } = await setup(t, kind, { [`${BACKENDS[kind].prefix}_BIN`]: '/missing/native-cli' });
    assert.equal((await run(jobs, 'hi')).error, 'executable_not_found');
  });
}
test('cwd is host-owned, with symlink and traversal escapes rejected', async t => {
  const { jobs, root } = await setup(t, 'codex');
  await mkdir(join(root, 'child'));
  await symlink(tmpdir(), join(root, 'outside'));
  for (const cwd of ['..', 'outside', tmpdir()]) {
    await assert.rejects(jobs.call({ action: 'start', task: 'inspect', cwd }), /cwd_outside_workspace/);
  }
  const start = await jobs.call({ action: 'start', task: 'inspect', cwd: 'child' });
  const end = await jobs.call({ action: 'status', job_id: start.job_id, wait_seconds: 5 });
  assert.ok(JSON.parse(end.answer).cwd.endsWith('/child'));
});
test('model cannot override permission mode, executable, environment, or model', async t => {
  const { jobs } = await setup(t, 'codex');
  for (const key of ['permissionMode', 'command', 'env', 'model']) {
    await assert.rejects(jobs.call({ action: 'start', task: 'hi', [key]: 'unsafe' }), /unknown_argument/);
  }
  await assert.rejects(jobs.call({ action: 'start', task: '' }), /task_required/);
  await assert.rejects(jobs.call({ action: 'status', job_id: 'unknown' }), /unknown_job/);
});
test('native argv uses no shell and never bypasses permissions', () => {
  for (const backend of Object.values(BACKENDS)) {
    const config = configuration(backend, {});
    const args = invocation(backend, config);
    assert.ok(!args.some(arg => /bypass|skip-permissions/.test(arg)));
    assert.throws(() => configuration(backend, { [`${backend.prefix}_PERMISSION_MODE`]: 'bypassPermissions' }));
    assert.throws(() => configuration(backend, { [`${backend.prefix}_TIMEOUT_SECONDS`]: '-1' }));
  }
});
test('shutdown kills a native descendant process', async t => {
  const { jobs, root } = await setup(t, 'codex');
  await jobs.call({ action: 'start', task: 'descendant' });
  let pid;
  for (let n = 0; n < 100; n++) {
    try { pid = Number(await readFile(join(root, 'descendant.pid'), 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  assert.ok(pid);
  await jobs.dispose();
  let state;
  for (let n = 0; n < 100; n++) {
    try {
      state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    } catch (error) {
      if (error.status !== 1) throw error;
      state = '';
    }
    if (!state || state.startsWith('Z')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(!state || state.startsWith('Z'), `Descendant is still executing: ${state}`);
  await assert.rejects(jobs.call({ action: 'start', task: 'hi' }), /extension_stopping/);
});
