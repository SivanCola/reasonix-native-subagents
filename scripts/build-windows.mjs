import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export async function buildWindows(check) {
  const files = ['main.go', 'go.mod', 'go.sum'];
  const sourceHash = hash(Buffer.concat(await Promise.all(files.map(file => readFile(resolve(root, 'native/windows', file))))));
  const paths = ['codex-subagent', 'claude-code-subagent'].map(name => resolve(root, 'packages', name, 'runtime'));
  if (check) {
    for (const path of paths) {
      const metadata = JSON.parse(await readFile(resolve(path, 'launch.build.json')));
      if (metadata.sourceSha256 !== sourceHash || metadata.exeSha256 !== hash(await readFile(resolve(path, 'launch.exe')))) {
        throw new Error('Stale Windows executable; run npm run build');
      }
    }
  } else {
    await mkdir(paths[0], { recursive: true });
    execFileSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', resolve(paths[0], 'launch.exe'), '.'], {
      cwd: resolve(root, 'native/windows'), env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }, stdio: 'inherit',
    });
    await mkdir(paths[1], { recursive: true });
    await copyFile(resolve(paths[0], 'launch.exe'), resolve(paths[1], 'launch.exe'));
    const metadata = JSON.stringify({ target: 'windows/amd64 (Windows 11 ARM64 uses x64 emulation)',
      sourceSha256: sourceHash, exeSha256: hash(await readFile(resolve(paths[0], 'launch.exe'))) }, null, 2) + '\n';
    for (const path of paths) await writeFile(resolve(path, 'launch.build.json'), metadata);
  }
  // Development-only location for source-module tests; not a user setting.
  await copyFile(resolve(paths[0], 'launch.exe'), resolve(root, 'src/launch.exe'));
}
