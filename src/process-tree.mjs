import { execFileSync } from 'node:child_process';

function snapshot() {
  let text;
  try {
    text = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    });
  } catch { throw new Error('cleanup_scan_failed'); }
  const rows = new Map();
  for (const line of text.trim().split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9) throw new Error('cleanup_scan_failed');
    const [pid, parent, group] = fields.slice(0, 3).map(Number);
    if (![pid, parent, group].every(Number.isSafeInteger)) throw new Error('cleanup_scan_failed');
    rows.set(pid, { pid, parent, group, state: fields[3], birth: fields.slice(4).join(' ') });
  }
  return rows;
}

export class ProcessTree {
  constructor(pid) {
    this.pid = pid;
    this.known = new Map();
    this.timer = setInterval(() => {
      try { this.capture(); } catch { /* Stop performs an authoritative scan. */ }
    }, 200);
    this.timer.unref();
  }

  capture() {
    const rows = snapshot();
    if (!this.known.size && rows.has(this.pid)) this.known.set(this.pid, rows.get(this.pid));
    const owned = new Set([...this.known].filter(([pid, row]) => rows.get(pid)?.birth === row.birth).map(([pid]) => pid));
    let changed;
    do {
      changed = false;
      for (const [pid, row] of rows) {
        if (!owned.has(pid) && owned.has(row.parent)) {
          owned.add(pid);
          this.known.set(pid, row);
          changed = true;
        }
      }
    } while (changed);
    return rows;
  }

  signal(signal, rows) {
    const live = [...this.known.values()].filter(row => rows.get(row.pid)?.birth === row.birth && !rows.get(row.pid).state.startsWith('Z'));
    const stillRunning = row => {
      const current = snapshot().get(row.pid);
      return current?.birth === row.birth && !current.state.startsWith('Z');
    };
    for (const row of live.reverse()) {
      try { process.kill(row.pid, signal); }
      catch (error) {
        if (error.code !== 'ESRCH' && stillRunning(row)) throw new Error('cleanup_signal_failed', { cause: error });
      }
    }
    if (live.some(row => rows.get(row.pid).group === this.pid)) {
      try { process.kill(-this.pid, signal); }
      catch (error) {
        if (error.code !== 'ESRCH' && live.some(stillRunning)) throw new Error('cleanup_signal_failed', { cause: error });
      }
    }
  }

  async stop() {
    clearInterval(this.timer);
    this.signal('SIGTERM', this.capture());
    await new Promise(resolve => setTimeout(resolve, 500));
    this.signal('SIGKILL', this.capture());
    const deadline = Date.now() + 2000;
    do {
      const rows = this.capture();
      const running = [...this.known].some(([pid, old]) => {
        const row = rows.get(pid);
        return row?.birth === old.birth && !row.state.startsWith('Z');
      });
      if (!running) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error('cleanup_incomplete');
  }
}
