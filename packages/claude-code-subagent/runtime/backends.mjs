import { settings, executableDirectories, nativeExecutable } from './settings.mjs';

export const BACKENDS = {
  codex: { name: 'codex-subagent', tool: 'subagent_codex', command: 'codex', prefix: 'REASONIX_CODEX' },
  claude: { name: 'claude-code-subagent', tool: 'subagent_claude_code', command: 'claude', prefix: 'REASONIX_CLAUDE' },
};

export function configuration(backend, env = process.env) {
  const prefix = backend.prefix;
  const saved = settings(env)[backend.command] || {};
  const directories = executableDirectories(env);
  const mode = env[`${prefix}_PERMISSION_MODE`] || saved.permissionMode || (backend.command === 'codex' ? 'read-only' : 'dontAsk');
  const modes = backend.command === 'codex'
    ? ['read-only', 'workspace-write', 'approve-for-me']
    : ['dontAsk', 'acceptEdits', 'plan', 'auto'];
  if (!modes.includes(mode)) throw new Error('invalid_permission_mode');
  const deadline = Number(env[`${prefix}_TIMEOUT_SECONDS`] || saved.timeoutSeconds || 600);
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 3600) throw new Error('invalid_timeout');
  return {
    command: env[`${prefix}_BIN`] || saved.bin || nativeExecutable(backend.command, directories),
    model: env[`${prefix}_MODEL`] || saved.model || undefined,
    mode, deadline, path: directories.join(':'),
  };
}

export function invocation(backend, config) {
  if (backend.command === 'codex') {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--color', 'never'];
    if (config.mode === 'approve-for-me') args.push('--approve-for-me');
    else args.push('--sandbox', config.mode, '-c', 'approval_policy="never"');
    if (config.model) args.push('--model', config.model);
    args.push('-');
    return args;
  }
  const args = [
    '--print', '--input-format', 'text', '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--permission-mode', config.mode,
    '--disallowedTools', 'AskUserQuestion',
  ];
  if (config.model) args.push('--model', config.model);
  return args;
}

export function resultReader(backend) {
  let answer = '';
  let final = '';
  let complete = false;
  let failure;
  return {
    event(event) {
      if (!event || typeof event !== 'object') throw new Error('invalid_output');
      if (backend.command === 'codex') {
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          if (typeof event.item.text !== 'string') throw new Error('invalid_output');
          if (event.item.phase === 'final_answer') final = event.item.text;
          else if (event.item.phase == null || event.item.phase === 'partial_answer') answer = event.item.text;
        }
        if (event.type === 'turn.completed') complete = true;
        if (event.type === 'turn.failed') failure = 'native_task_failed';
      } else if (event.type === 'result') {
        complete = event.subtype === 'success' && event.is_error === false;
        if (!complete) failure = 'native_task_failed';
        if (typeof event.result === 'string') final = event.result;
      }
    },
    finish(exit) {
      const text = final || answer;
      const error = exit.problem || failure || (exit.code !== 0 ? 'native_process_failed'
        : !complete ? 'incomplete_result' : !text.trim() ? 'empty_result' : undefined);
      if (error) return { status: 'failed', error, exitCode: exit.code, signal: exit.signal };
      if (Buffer.byteLength(text) > 128 * 1024) return { status: 'failed', error: 'answer_limit' };
      return { status: 'completed', answer: text };
    },
  };
}
