import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKENDS } from '../src/backends.mjs';

for (const backend of Object.values(BACKENDS)) {
  test(`${backend.name}: copied package handshake, call, long poll and shutdown`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'extension-protocol-test-'));
    await cp(resolve('packages', backend.name), join(root, 'package'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(root, 'package/reasonix-plugin.json')));
    const child = spawn(process.execPath, [join(root, 'package/runtime/main.mjs')], {
      cwd: root, env: { ...process.env, [`${backend.prefix}_BIN`]: resolve('tests/fixture.mjs') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(async () => { child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); });
    let id = 0;
    const pending = new Map();
    createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line);
      pending.get(frame.id)?.(frame);
      pending.delete(frame.id);
    });
    const request = (method, params) => {
      const key = ++id;
      const result = new Promise(resolve => pending.set(key, resolve));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
      return result;
    };
    const init = await request('extension/initialize', {
      protocolId: 'reasonix.extension.v2', protocolVersion: '2',
      manifest: { tools: manifest.runtime.tools.map(tool => tool.name) },
      session: { workspaceRoot: root },
    });
    assert.equal(init.result.protocolVersion, '2');
    assert.deepEqual(init.result.tools, [backend.tool]);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'extension/initialized' }) + '\n');
    const call = async args => {
      const frame = await request('extension/tool/call', { name: backend.tool, arguments: args, timeoutMillis: 300000 });
      assert.ok(frame.result, JSON.stringify(frame));
      return JSON.parse(frame.result.content);
    };
    const start = await call({ action: 'start', task: 'copied package works' });
    const end = await call({ action: 'status', job_id: start.job_id, wait_seconds: 5 });
    assert.equal(end.answer, 'copied package works');
    assert.equal((await request('extension/shutdown', {})).result.accepted, true);
  });
}
