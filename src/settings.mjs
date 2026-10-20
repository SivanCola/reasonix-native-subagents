import { readFileSync, readdirSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';

export function settings(env = process.env) {
  const home = env.HOME || homedir();
  const directory = env.REASONIX_SUBAGENT_CONFIG_DIR || join(home, '.reasonix/native-subagents');
  if (!isAbsolute(directory)) throw new Error('invalid_config_directory');
  let data;
  try { data = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('config_unreadable_or_invalid');
  }
  if (!data || Array.isArray(data) || data.schemaVersion !== 1) throw new Error('unsupported_config_schema');
  for (const key of ['codex', 'claude']) {
    const value = data[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_backend_config');
    for (const field of ['bin', 'model', 'permissionMode']) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) {
        throw new Error('invalid_backend_config');
      }
    }
    if (value.timeoutSeconds !== undefined &&
        (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600)) {
      throw new Error('invalid_timeout');
    }
  }
  // Read-only ownership: preserve all unknown fields, never rewrite user settings.
  return data;
}

function versions(root, suffix) {
  try {
    return readdirSync(root).filter(name => /^v?\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.replace(/^v/, '').localeCompare(a.replace(/^v/, ''), 'en', { numeric: true }))
      .map(name => join(root, name, suffix));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('cli_discovery_failed');
  }
}

export function executableDirectories(env = process.env) {
  const home = env.HOME || homedir();
  return [...new Set([
    ...(env.PATH || '').split(':').filter(isAbsolute),
    join(home, '.local/bin'), dirname(process.execPath),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    join(home, '.volta/bin'), join(home, '.asdf/shims'),
    ...versions(join(home, '.local/share/fnm/node-versions'), 'installation/bin'),
    ...versions(join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin'),
    ...versions(join(home, '.nvm/versions/node'), 'bin'),
    ...versions(join(home, '.asdf/installs/nodejs'), 'bin'),
  ])];
}

export function nativeExecutable(command, directories) {
  for (const directory of directories) {
    const candidate = join(directory, command);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return command; // Preserve the existing executable_not_found result contract.
}
