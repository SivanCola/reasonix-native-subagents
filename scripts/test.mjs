import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const files = (await readdir('tests')).filter(file => file.endsWith('.test.mjs') &&
  (process.platform === 'win32' ? file === 'windows.test.mjs' : file !== 'windows.test.mjs'));
const child = spawn(process.execPath, ['--test', ...files.map(file => 'tests/' + file)], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
