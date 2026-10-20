import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { configuration, BACKENDS } from '../src/backends.mjs';
import { nativeExecutable, executableDirectories } from '../src/settings.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'native-settings-'));
  const dir = join(home, '.reasonix/native-subagents');
  await mkdir(dir, { recursive: true });
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, dir, env: { HOME: home, PATH: '/usr/bin:/bin' } };
}
test('external settings: defaults, both backends, env precedence, unknown fields and invalid data', async t => {
  const { dir, env } = await fixture(t);
  assert.equal(configuration(BACKENDS.codex, env).mode, 'read-only');
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, future: true,
    codex: { permissionMode: 'workspace-write', model: 'saved', timeoutSeconds: 17 },
    claude: { permissionMode: 'acceptEdits' } }));
  assert.equal(configuration(BACKENDS.codex, env).deadline, 17);
  assert.equal(configuration(BACKENDS.claude, env).mode, 'acceptEdits');
  assert.equal(configuration(BACKENDS.codex, { ...env, REASONIX_CODEX_MODEL: 'override' }).model, 'override');
  assert.equal(configuration(BACKENDS.codex, { ...env, REASONIX_CODEX_BIN: '/missing/explicit' }).command, '/missing/explicit');
  for (const value of ['{', '{"schemaVersion":2}', '{"schemaVersion":1,"codex":{"permissionMode":"bypass"}}',
    '{"schemaVersion":1,"codex":{"timeoutSeconds":0}}', '{"schemaVersion":1,"claude":{"bin":[]}}']) {
    await writeFile(path, value);
    assert.throws(() => configuration(BACKENDS.codex, env));
  }
  await rm(path);
  await mkdir(path);
  assert.throws(() => configuration(BACKENDS.codex, env), /config_unreadable_or_invalid/);
});
test('CLI discovery follows installed version upgrades with numeric version order', async t => {
  const { home, env } = await fixture(t);
  for (const version of ['v9.0.0', 'v22.9.0', 'v22.10.0']) {
    const bin = join(home, '.nvm/versions/node', version, 'bin');
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, join(bin, 'unique-test-cli'));
  }
  assert.match(nativeExecutable('unique-test-cli', executableDirectories(env)), /v22\.10\.0/);
  await rm(join(home, '.nvm/versions/node/v22.10.0'), { recursive: true });
  assert.match(nativeExecutable('unique-test-cli', executableDirectories(env)), /v22\.9\.0/);
});
test('launcher persistent Node override and invalid explicit override fail closed', async t => {
  const { dir, env } = await fixture(t);
  const launcher = resolve('packages/codex-subagent/runtime/launch.sh');
  await writeFile(join(dir, 'node-path'), process.execPath + '\n');
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'extension/initialize',
    params: { protocolId: 'reasonix.extension.v2', protocolVersion: '2',
      manifest: { tools: ['subagent_codex'] }, session: { workspaceRoot: dir } } }) + '\n';
  const out = execFileSync(launcher, [], { env, input: request, encoding: 'utf8' });
  assert.equal(JSON.parse(out).result.version, '0.1.2');
  const invalid = spawnSync(launcher, [], { env: { ...env, REASONIX_SUBAGENT_NODE: '/missing/node' }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /node_override_requires_node_20/);
});
test('GUI launcher selects the latest compatible Node and rediscovers after replacement', async t => {
  const { home, env } = await fixture(t);
  const launcher = resolve('packages/codex-subagent/runtime/launch.sh');
  for (const version of ['98.9.0', '98.10.0', '99.0.0']) {
    const bin = join(home, '.local/share/fnm/node-versions', `v${version}`, 'installation/bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'node'),
      `#!/bin/sh\nif [ "$1" = --version ]; then echo v${version}; else echo selected-${version}; fi\n`,
      { mode: 0o755 });
  }
  const run = () => execFileSync(launcher, [], { env: { ...env, PATH: '/nonexistent' }, encoding: 'utf8' }).trim();
  assert.equal(run(), 'selected-99.0.0');
  await rm(join(home, '.local/share/fnm/node-versions/v99.0.0'), { recursive: true });
  assert.equal(run(), 'selected-98.10.0');
});
