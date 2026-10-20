import { copyFile, chmod, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const checkout = process.argv[2];
if (!checkout) throw new Error('Usage: node scripts/host-check.mjs /path/to/Reasonix [package-source-root]');
const destination = resolve(checkout, 'internal/ext/extension/sidecar/native_market_package_test.go');
await copyFile('tests/reasonix_host_test.go', destination, 1);
await chmod('tests/fixture.mjs', 0o755);
try {
  const child = spawn('go', ['test', './internal/ext/extension/sidecar', '-run', '^TestNativeSubagentMarketplacePackages$', '-count=1', '-v'], {
    cwd: resolve(checkout), stdio: 'inherit', env: {
      ...process.env,
      REASONIX_NATIVE_SOURCE: process.argv[3] || resolve('packages'),
      REASONIX_NATIVE_FIXTURE: resolve('tests/fixture.mjs'),
    },
  });
  const code = await new Promise(resolve => child.once('exit', resolve));
  if (code !== 0) process.exitCode = code || 1;
} finally {
  await unlink(destination);
}
