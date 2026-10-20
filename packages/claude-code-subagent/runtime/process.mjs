import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function launch(command, args, options, onEvent, onExit) {
  const child = spawn(command, args, {
    ...options, shell: false, detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  let buffer = '';
  let bytes = 0;
  let problem;
  const decoder = new StringDecoder('utf8');
  const closedPromise = new Promise(resolve => child.once('close', resolve));
  const kill = signal => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  let escalation;
  let cleanup;
  let cleaned = false;
  const stop = () => {
    if (cleanup) return;
    kill('SIGTERM');
    cleanup = new Promise(resolve => {
      escalation = setTimeout(() => {
        kill('SIGKILL');
        cleaned = true;
        resolve();
      }, 500);
    });
  };
  child.stdin.on('error', () => {});
  child.stderr.on('data', () => {});
  child.stdout.on('data', chunk => {
    if (problem) return;
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) {
      problem = 'output_limit';
      stop();
      return;
    }
    buffer += decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); }
      catch { problem = 'invalid_output'; stop(); return; }
    }
  });
  child.once('error', error => {
    problem = error.code === 'ENOENT' ? 'executable_not_found' : 'spawn_failed';
  });
  child.once('close', async (code, signal) => {
    closed = true;
    buffer += decoder.end();
    if (!problem && buffer.trim()) {
      try { onEvent(JSON.parse(buffer)); }
      catch { problem = 'invalid_output'; }
    }
    // Detached descendants may outlive their direct parent.
    stop();
    await cleanup;
    onExit({ code, signal, problem });
  });
  return {
    child, stop,
    get active() { return !closed || !cleaned; },
    async dispose() {
      stop();
      if (!closed) await closedPromise;
      await cleanup;
      clearTimeout(escalation);
    },
  };
}
