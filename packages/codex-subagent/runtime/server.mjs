import { createInterface } from 'node:readline';
import { BACKENDS } from './backends.mjs';
import { Jobs } from './jobs.mjs';

export function serve(kind) {
  const backend = BACKENDS[kind];
  let state = 'new';
  let jobs;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const fail = (id, code, message) => send({ id, error: { code, message } });
  let shutdown;
  const close = () => {
    if (shutdown) return shutdown;
    state = 'closed';
    shutdown = (async () => { await jobs?.dispose(); lines.close(); })();
    return shutdown;
  };
  process.stdout.on('error', () => { void close().then(() => process.exit(1)); });
  process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
  process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
  lines.once('close', () => { void close().then(() => process.exit(0)); });
  lines.on('line', line => {
    void (async () => {
      let frame;
      try {
        if (Buffer.byteLength(line) > 256 * 1024) throw new Error();
        frame = JSON.parse(line);
      } catch { fail(null, -32700, 'Invalid JSON frame'); return; }
      const { id, method, params = {} } = frame;
      if (frame.jsonrpc !== '2.0' || typeof method !== 'string' ||
          (id !== undefined && !Number.isSafeInteger(id))) {
        fail(id ?? null, -32600, 'Invalid request'); return;
      }
      if (method === 'extension/initialized' && state === 'initializing' && id === undefined) {
        state = 'ready'; return;
      }
      if (id === undefined) return;
      if (method === 'extension/initialize' && state === 'new') {
        if (params.protocolId !== 'reasonix.extension.v2' || params.protocolVersion !== '2' ||
            typeof params.session?.workspaceRoot !== 'string' || !params.session.workspaceRoot ||
            !params.manifest?.tools?.includes(backend.tool)) {
          fail(id, -32602, 'Unsupported protocol or missing workspace/tool declaration'); return;
        }
        jobs = new Jobs(backend, params.session.workspaceRoot);
        state = 'initializing';
        send({ id, result: { protocolVersion: '2', name: backend.name, version: '0.1.3',
          stateSchemaVersion: 0, tools: [backend.tool] } });
        return;
      }
      if (method === 'extension/shutdown') {
        await jobs?.dispose();
        send({ id, result: { accepted: true } });
        void close();
        return;
      }
      if (state !== 'ready') { fail(id, -32600, 'Extension is not ready'); return; }
      if (method !== 'extension/tool/call') { fail(id, -32601, 'Unknown method'); return; }
      if (params.name !== backend.tool) { fail(id, -32602, 'Unknown tool'); return; }
      try {
        const result = await jobs.call(params.arguments);
        send({ id, result: { content: JSON.stringify(result),
          isError: ['failed', 'timed_out'].includes(result.status) } });
      } catch (error) {
        const safe = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'operation_failed';
        send({ id, result: { content: JSON.stringify({ error: safe }), isError: true } });
      }
    })().catch(() => { void close(); });
  });
}
