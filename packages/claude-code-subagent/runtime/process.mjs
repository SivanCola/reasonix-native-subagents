import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { ProcessTree } from './process-tree.mjs';

export function launch(command, args, options, onEvent, onExit) {
  const child = spawn(command, args, {
    ...options, shell: false, detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  let fragments = [];
  let bytes = 0;
  let problem;
  const decoder = new StringDecoder('utf8');
  const closedPromise = new Promise(resolve => child.once('close', resolve));
  const tree = child.pid ? new ProcessTree(child.pid) : null;
  let cleanup;
  let cleanupError;
  let cleaned = false;
  const stop = () => {
    if (cleanup) return;
    cleanup = Promise.resolve().then(() => tree?.stop()).catch(error => {
      cleanupError = error;
      problem = error.message;
      child.kill('SIGKILL');
    }).finally(() => { cleaned = true; });
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
    const text = decoder.write(chunk);
    let start = 0;
    let newline;
    while ((newline = text.indexOf('\n', start)) >= 0) {
      fragments.push(text.slice(start, newline));
      const line = fragments.join('');
      fragments = [];
      start = newline + 1;
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); }
      catch { problem = 'invalid_output'; stop(); return; }
    }
    if (start < text.length) fragments.push(text.slice(start));
  });
  child.once('error', error => {
    problem = error.code === 'ENOENT' ? 'executable_not_found' : 'spawn_failed';
  });
  child.once('close', async (code, signal) => {
    closed = true;
    const buffer = fragments.join('') + decoder.end();
    fragments = [];
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
      if (cleanupError) throw cleanupError;
    },
  };
}
