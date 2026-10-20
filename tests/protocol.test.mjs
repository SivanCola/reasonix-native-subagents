import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, cp, rm, readFile, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKENDS } from '../src/backends.mjs';

for (const backend of Object.values(BACKENDS)) {
  test(`${backend.name}: GUI launcher discovers tools and preserves config across replacement`, { timeout: 20000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'extension-protocol-test-'));
    const home = join(root, 'home with spaces');
    const nodeBin = join(home, '.local/share/fnm/node-versions/v99.0.0/installation/bin');
    const cliBin = join(home, '.local/bin');
    const configDir = join(home, '.reasonix/native-subagents');
    await Promise.all([nodeBin, cliBin, configDir].map(path => mkdir(path, { recursive: true })));
    await symlink(process.execPath, join(nodeBin, 'node'));
    await symlink(resolve('tests/fixture.mjs'), join(cliBin, backend.command));
    const saved = JSON.stringify({ schemaVersion: 1, [backend.command]: {
      permissionMode: backend.command === 'codex' ? 'workspace-write' : 'acceptEdits',
      model: 'persistent-model', timeoutSeconds: 12,
    }, futureField: { preserve: true } });
    await writeFile(join(configDir, 'config.json'), saved);
    await cp(resolve('packages', backend.name), join(root, 'package'), { recursive: true });
    await rm(join(root, 'package'), { recursive: true });
    await cp(resolve('packages', backend.name), join(root, 'package'), { recursive: true });
    assert.equal(await readFile(join(configDir, 'config.json'), 'utf8'), saved);
    const manifest = JSON.parse(await readFile(join(root, 'package/reasonix-plugin.json')));
    assert.equal(manifest.runtime.env, undefined);
    const child = spawn(manifest.runtime.command.replace('${REASONIX_PLUGIN_ROOT}', join(root, 'package')), [], {
      cwd: root, env: { HOME: home, PATH: '/usr/bin:/bin' },
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
    const { configuration } = await import('../src/backends.mjs');
    const config = configuration(backend, { HOME: home, PATH: '/usr/bin:/bin' });
    assert.equal(config.model, 'persistent-model');
    assert.equal(config.deadline, 12);
    assert.equal(config.command, join(cliBin, backend.command));
    assert.equal((await request('extension/shutdown', {})).result.accepted, true);
  });
}
