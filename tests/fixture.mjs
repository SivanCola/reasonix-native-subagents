#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const task = readFileSync(0, 'utf8');
const codex = process.argv.includes('exec');
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
if (task === 'hang') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (task === 'descendant' || task === 'detached-descendant') {
  spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync("descendant.pid",String(process.pid));setInterval(()=>{},1000)'], {
    stdio: 'ignore', detached: task === 'detached-descendant',
  });
  setInterval(() => {}, 1000);
} else if (task === 'malformed') {
  process.stdout.write('not JSON\n');
} else if (task === 'overflow') {
  process.stdout.write('x'.repeat(17 * 1024 * 1024));
} else if (task === 'fail') {
  console.error('secret-token-must-not-escape');
  emit(codex ? { type: 'turn.failed', error: { message: 'secret-token-must-not-escape' } }
    : { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['secret-token-must-not-escape'] });
  process.exitCode = 1;
} else if (task === 'empty') {
  emit(codex ? { type: 'turn.completed' } : { type: 'result', subtype: 'success', is_error: false, result: '' });
} else if (task === 'incomplete') {
  emit(codex ? { type: 'item.completed', item: { type: 'agent_message', text: 'not final yet' } }
    : { type: 'assistant', message: { content: [{ type: 'text', text: 'not final yet' }] } });
} else {
  if (task === 'edit-fixture') {
    writeFileSync('answer.mjs', 'export const answer = 42;\n');
    execFileSync(process.execPath, ['answer.test.mjs']);
  }
  if (task === 'large-record') emit({ type: 'diagnostic', data: '界'.repeat(2 * 1024 * 1024) });
  const text = task === 'inspect' ? JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }) : task;
  if (codex) {
    emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: 'private thinking' } });
    emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'final_answer', text } });
    emit({ type: 'turn.completed', usage: { input_tokens: 1 } });
  } else {
    emit({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private thinking' }] } });
    emit({ type: 'result', subtype: 'success', is_error: false, result: text });
  }
}
