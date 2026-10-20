import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { BACKENDS } from '../src/backends.mjs';

const [kind, packagePath] = process.argv.slice(2);
const backend = BACKENDS[kind];
if (!backend) throw new Error('Usage: node scripts/smoke.mjs codex|claude [installed-package-path]');
const root = await mkdtemp(join(tmpdir(), 'reasonix-native-smoke-'));
const nonce = randomUUID();
await writeFile(join(root, 'nonce.txt'), nonce + '\n');
const child = spawn(process.execPath, [resolve(packagePath || `packages/${backend.name}`, 'runtime/main.mjs')], {
  cwd: root, env: { ...process.env, [`${backend.prefix}_TIMEOUT_SECONDS`]: '120' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let id = 0;
const pending = new Map();
createInterface({ input: child.stdout }).on('line', line => {
  const frame = JSON.parse(line);
  pending.get(frame.id)?.(frame);
  pending.delete(frame.id);
});
child.once('exit', () => {
  for (const settle of pending.values()) settle({ error: { message: 'sidecar_exited' } });
});
const request = (method, params = {}) => {
  const key = ++id;
  const result = new Promise(resolve => pending.set(key, resolve));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
  return result;
};
const call = async args => {
  const frame = await request('extension/tool/call', { name: backend.tool, arguments: args, timeoutMillis: 300000 });
  assert.ok(frame.result, JSON.stringify(frame.error));
  return JSON.parse(frame.result.content);
};
try {
  const init = await request('extension/initialize', {
    protocolId: 'reasonix.extension.v2', protocolVersion: '2',
    manifest: { tools: [backend.tool] }, session: { workspaceRoot: root },
  });
  assert.equal(init.result?.protocolVersion, '2');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'extension/initialized' }) + '\n');
  let result = await call({ action: 'start', task: 'Read nonce.txt in the current directory. Return only its exact content. Do not modify any file, access the network with tools, or inspect any other files.' });
  while (['running', 'cancelling'].includes(result.status)) {
    console.log(JSON.stringify({ backend: kind, status: result.status }));
    result = await call({ action: 'status', job_id: result.job_id, wait_seconds: 30 });
  }
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.answer.trim(), nonce, 'Native CLI must actually read the file; nonce is absent from the prompt.');
  console.log(JSON.stringify({ backend: kind, status: 'passed', scenario: 'native CLI read nonce from disposable workspace' }));
} finally {
  await request('extension/shutdown');
  child.stdin.end();
  await rm(root, { recursive: true, force: true });
}
