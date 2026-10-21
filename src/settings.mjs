import { readFileSync, readdirSync, accessSync, statSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, delimiter, extname } from 'node:path';

export function userHome(env = process.env) {
  return (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
}

export function pathValue(env = process.env) {
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path');
  return key ? env[key] : '';
}

export function withPath(env, path) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (key.toLowerCase() === 'path') delete result[key];
  return { ...result, PATH: path };
}

export function settings(env = process.env) {
  const home = userHome(env);
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
  const home = userHome(env);
  if (process.platform === 'win32') {
    const roots = [env.FNM_DIR, env.APPDATA && join(env.APPDATA, 'fnm'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'fnm')].filter(Boolean);
    return [...new Set([
      ...pathValue(env).split(delimiter), join(home, '.local/bin'), dirname(process.execPath),
      env.APPDATA && join(env.APPDATA, 'npm'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Volta/bin'),
      join(home, '.volta/bin'), join(home, 'scoop/shims'),
      env.NVM_SYMLINK,
      ...roots.flatMap(root => versions(join(root, 'node-versions'), 'installation')),
      ...[env.NVM_HOME, env.APPDATA && join(env.APPDATA, 'nvm'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'nvm')]
        .filter(Boolean).flatMap(root => versions(root, '')),
    ].filter(value => value && isAbsolute(value)))];
  }
  return [...new Set([
    ...pathValue(env).split(delimiter).filter(isAbsolute),
    join(home, '.local/bin'), dirname(process.execPath),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    join(home, '.volta/bin'), join(home, '.asdf/shims'),
    ...versions(join(home, '.local/share/fnm/node-versions'), 'installation/bin'),
    ...versions(join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin'),
    ...versions(join(home, '.nvm/versions/node'), 'bin'),
    ...versions(join(home, '.asdf/installs/nodejs'), 'bin'),
  ])];
}

export function nativeExecutable(command, directories, env = process.env) {
  const windows = process.platform === 'win32';
  const extensions = windows && !extname(command)
    ? [...new Set(['.exe', '.com', '.cmd', '.bat', ...(env.PATHEXT || '').toLowerCase().split(';')])]
      .filter(value => /^\.(exe|com|cmd|bat)$/.test(value)) : [''];
  const candidates = isAbsolute(command) ? [command] : directories.map(directory => join(directory, command));
  for (const candidate of candidates) {
    for (const extension of extensions) {
      try {
        const file = candidate + extension;
        if (!statSync(file).isFile()) continue;
        accessSync(file, windows ? constants.F_OK : constants.X_OK);
        return file;
      } catch {}
    }
  }
  return command; // Preserve the existing executable_not_found result contract.
}
