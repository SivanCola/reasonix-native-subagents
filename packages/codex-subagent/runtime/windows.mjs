import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extname, join } from 'node:path';
import { existsSync } from 'node:fs';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('./launch.exe', import.meta.url));

// cmd.exe escaping adapted from cross-spawn 7.0.6 (MIT), see THIRD_PARTY.md.
const meta = /([()\][%!^"`<>&|;, *?])/g;
function argument(value, doubleEscape) {
  value = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  value = `"${value}"`.replace(meta, '^$1');
  return doubleEscape ? value.replace(meta, '^$1') : value;
}
export function commandLine(command, args) {
  if ([command, ...args].some(value => /[\r\n\0]/.test(value))) throw new Error('invalid_windows_argument');
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(command);
  return 'cmd.exe /d /v:off /s /c "' + [command.replace(meta, '^$1'), ...args.map(arg => argument(arg, doubleEscape))].join(' ') + '"';
}

export function windowsLaunch(command, args, options) {
  const name = `Local\\reasonix-subagent-task-${randomUUID()}`;
  const extension = extname(command).toLowerCase();
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    args = [command, ...args]; command = process.execPath;
  } else if (['.cmd', '.bat'].includes(extension)) {
    const line = commandLine(command, args);
    command = join(options.env.SystemRoot || options.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe');
    args = ['--raw-cmd', line];
  }
  // Preserve ENOENT from spawn for missing explicit executables.
  const useHelper = existsSync(command);
  const child = spawn(useHelper ? helper : command, useHelper ? ['--run', name, command, ...args] : args, {
    ...options, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  async function terminate() {
    try { await execute(helper, ['--stop', name], { windowsHide: true, timeout: 7000 }); return true; }
    catch (error) {
      if (error.code === 2) return false; // The helper has not assigned its job yet, or already exited.
      throw new Error('cleanup_incomplete');
    }
  }
  return { child, tree: { async stop() {
    if (!useHelper) return;
    await terminate();
    // An empty job can accept a process even after TerminateJobObject. Stop
    // the supervisor too, so cancellation racing CreateProcess cannot launch
    // a new child afterward. Its non-inherited job handle closes on death.
    child.kill('SIGKILL');
    await closed;
    await terminate();
  } } };
}
