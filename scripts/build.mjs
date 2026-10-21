import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BACKENDS } from '../src/backends.mjs';
import { buildWindows } from './build-windows.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
await buildWindows(check);
async function emit(path, content) {
  if (check) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`Stale package: ${path}`);
  } else {
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
}
for (const [kind, backend] of Object.entries(BACKENDS)) {
  const dir = resolve(root, 'packages', backend.name);
  const title = kind === 'codex' ? 'Codex' : 'Claude Code';
  const manifest = {
    apiVersion: 'reasonix.io/plugin/v2',
    name: backend.name, version: '0.1.3',
    description: `Delegate a self-contained task to native ${title}, using its login and settings. Requires Node.js 20+ and the native CLI.`,
    contributes: { prompts: ['prompts'] },
    runtime: {
      command: '${REASONIX_PLUGIN_ROOT}/runtime/launch',
      capabilities: ['tools'],
      tools: [{
        name: backend.tool,
        description: `Delegate to native ${title} in this workspace. start returns a job_id; ALWAYS poll status with wait_seconds:30 until completed/failed/timed_out/cancelled, then use its answer. cancel stops an unwanted job. One active job per extension. Tasks may edit files subject to user-configured native permissions. A job has fresh context: supply the full task. No automatic completion notification. Never claim success while running.`,
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['start', 'status', 'cancel'] },
            task: { type: 'string', description: 'Required for start. Self-contained text; maximum 48 KiB.' },
            cwd: { type: 'string', description: 'Optional start-only subdirectory within the session workspace; default workspace root.' },
            job_id: { type: 'string', description: 'Required for status/cancel; use exactly the returned job_id.' },
            wait_seconds: { type: 'integer', minimum: 0, maximum: 30, description: 'Status-only long poll; use 30 while running.' },
          },
          required: ['action'],
        },
        readOnly: false,
      }],
    },
  };
  await emit(resolve(dir, 'reasonix-plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const file of ['server.mjs', 'jobs.mjs', 'process.mjs', 'process-tree.mjs', 'backends.mjs', 'settings.mjs', 'windows.mjs', 'launch.sh']) {
    await emit(resolve(dir, 'runtime', file), await readFile(resolve(root, 'src', file), 'utf8'));
  }
  const entry = resolve(dir, 'runtime/main.mjs');
  await emit(entry, `#!/usr/bin/env node\nimport { serve } from './server.mjs';\nserve('${kind}');\n`);
  if (!check) await chmod(entry, 0o755);
  else if (process.platform !== 'win32' && !((await stat(entry)).mode & 0o111)) throw new Error('Entrypoint is not executable');
  const launcher = resolve(dir, 'runtime/launch.sh');
  if (!check) await chmod(launcher, 0o755);
  else if (process.platform !== 'win32' && !((await stat(launcher)).mode & 0o111)) throw new Error('Launcher is not executable');
  const portable = resolve(dir, 'runtime/launch');
  await emit(portable, await readFile(resolve(root, 'src/launch.sh'), 'utf8'));
  if (!check) await chmod(portable, 0o755);
  else if (process.platform !== 'win32' && !((await stat(portable)).mode & 0o111)) throw new Error('Launcher is not executable');
  await emit(resolve(dir, 'prompts/delegate.md'), `---
description: Delegate one task to ${title} and collect its result
argument-hint: <self-contained task>
---

Delegate the following task to the installed ${backend.tool} extension capability.
Discover it through use_capability, then call action=start with a complete task.
Poll action=status with the returned job_id and wait_seconds=30 until terminal.
Do not rerun start to check progress. Cancel it if the task is no longer wanted.
Report a failure honestly; independently verify requested file changes before claiming completion.
Do not send secrets or unrelated conversation history. Do not change native permission settings.

Task:
$ARGUMENTS
`);
  await emit(resolve(dir, 'LICENSE'), await readFile(resolve(root, 'LICENSE'), 'utf8'));
  for (const file of ['THIRD_PARTY.md', 'WINDOWS_LICENSE.txt']) await emit(resolve(dir, file), await readFile(resolve(root, file), 'utf8'));
  await emit(resolve(dir, 'README.md'), `# ${title} subagent / ${title} 子智能体

An independent Reasonix Studio Manifest v2 extension. Delegates a complete
text task to your installed, authenticated ${title} CLI in the session workspace.
Requires an installed Node.js 20+ and the native CLI, automatically discovered
from PATH and common Homebrew, user-local, fnm, nvm, Volta, Scoop and asdf locations.
Supports macOS/Linux and Windows x64; Windows 11 ARM64 runs the x64 launcher
under Windows emulation. Windows requires Node 20+ installed in the guest.
Windows verification uses simulated native CLIs in a real Win11 VM; actual
Windows account login and model requests have not been verified.

Install this directory through Studio's standard extension installer or market.
Use \`/${backend.name}:delegate <task>\`, or ask the model to use \`${backend.tool}\`.
The tool returns a job ID; query status with wait_seconds=30 until terminal.
Cancellation, a 600-second default deadline, fresh sessions and final-answer
selection are included. No automatic parent wakeup or conversation resume.

Default permission mode: \`${kind === 'codex' ? 'read-only' : 'dontAsk'}\`.
Store settings outside the package at \`~/.reasonix/native-subagents/config.json\`:
\`{"schemaVersion":1,"${kind}":{"permissionMode":"${kind === 'codex' ? 'workspace-write' : 'acceptEdits'}"}}\`.
This example enables edits; omit it to retain the default permissions.
Package upgrades never write this file. Optional backend fields: \`bin\`, \`model\`,
\`timeoutSeconds\`. Omit \`bin\` for automatic discovery.
Existing \`${backend.prefix}_PERMISSION_MODE\` environment settings take priority.
Optional \`${backend.prefix}_BIN\`,
\`${backend.prefix}_MODEL\`, and \`${backend.prefix}_TIMEOUT_SECONDS\`
control the executable, model and deadline. The model cannot change these
through tool arguments. Native configuration and authentication remain in effect.

This is a FULL TRUST sidecar, outside the Reasonix sandbox. It inherits the host
environment. Native tasks may edit files according to native permissions.
Cancel stops processes; it does not roll back changes. Reload cancels in-memory
jobs. Only the newest 16 job results survive within one runtime.

Minimal verification: create nonce.txt with a random value, then delegate
"Read nonce.txt and return only its content; do not modify files."
Expected: completed with the file's exact content. Missing CLI: failed with
executable_not_found. Authentication problems: failed with a stable failure code;
no raw stderr is exposed.

中文：通过扩展市场独立安装。使用现有 ${title} 登录与配置执行一次性任务，
支持查询和取消；不会替换主模型。需要 Node.js 20+ 和对应原生 CLI。
取消不回滚已修改文件；重载后任务 ID 不可恢复。默认权限如上，由用户配置，
不能由模型自行放宽。

Version: 0.1.3. License: MIT. Maintainer: SivanCola.
[Complete configuration, constraints and source](https://github.com/SivanCola/reasonix-native-subagents)
 · [Report an issue](https://github.com/SivanCola/reasonix-native-subagents/issues)
`);
}
