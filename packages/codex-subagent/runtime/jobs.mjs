import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { withPath } from './settings.mjs';
import { configuration, invocation, resultReader } from './backends.mjs';
import { launch } from './process.mjs';

export class Jobs {
  constructor(backend, workspace, env = process.env) {
    this.backend = backend;
    this.workspace = workspace;
    this.env = env;
    this.jobs = new Map();
    this.starting = false;
    this.closed = false;
  }

  async call(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_arguments');
    const allowed = ['action', 'task', 'cwd', 'job_id', 'wait_seconds'];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('unknown_argument');
    if (args.action === 'start') return this.start(args);
    if (!['status', 'cancel'].includes(args.action)) throw new Error('invalid_action');
    if (args.task !== undefined || args.cwd !== undefined) throw new Error('unexpected_task_arguments');
    const job = this.jobs.get(args.job_id);
    if (!job) throw new Error('unknown_job');
    if (args.action === 'cancel') {
      await this.cancel(job);
    } else {
      const seconds = args.wait_seconds ?? 0;
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 30) throw new Error('invalid_wait');
      if (['running', 'cancelling'].includes(job.status) && seconds) {
        let timer;
        await Promise.race([job.done, new Promise(resolve => { timer = setTimeout(resolve, seconds * 1000); })]);
        clearTimeout(timer);
      }
    }
    return this.snapshot(job);
  }

  async start(args) {
    if (this.closed) throw new Error('extension_stopping');
    if (args.job_id !== undefined || args.wait_seconds !== undefined) throw new Error('unexpected_job_arguments');
    if (typeof args.task !== 'string' || !args.task.trim() || Buffer.byteLength(args.task) > 48 * 1024) {
      throw new Error('task_required_max_48k');
    }
    if (args.cwd !== undefined && typeof args.cwd !== 'string') throw new Error('invalid_cwd');
    if (this.starting || [...this.jobs.values()].some(job => job.process.active)) throw new Error('task_already_running');
    this.starting = true;
    try {
      const root = await realpath(this.workspace);
      const cwd = await realpath(resolve(root, args.cwd || '.'));
      const rel = relative(root, cwd);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !(await stat(cwd)).isDirectory()) {
        throw new Error('cwd_outside_workspace');
      }
      const config = configuration(this.backend, this.env);
      const reader = resultReader(this.backend);
      if (this.closed) throw new Error('extension_stopping');
      const job = { id: randomUUID(), status: 'running', created: new Date().toISOString() };
      let settled;
      job.done = new Promise(resolve => { settled = resolve; });
      job.settle = settled;
      const env = withPath(this.env, config.path);
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      job.process = launch(config.command, invocation(this.backend, config), { cwd, env },
        event => reader.event(event), exit => {
          clearTimeout(job.timer);
          if (job.status === 'running') Object.assign(job, reader.finish(exit));
          job.settle();
        });
      job.timer = setTimeout(() => {
        void this.cancel(job, 'timed_out');
      }, config.deadline * 1000);
      job.process.child.stdin.end(args.task);
      for (const [id, old] of this.jobs) {
        if (this.jobs.size < 16) break;
        if (old.status !== 'running') this.jobs.delete(id);
      }
      this.jobs.set(job.id, job);
      return this.snapshot(job);
    } finally {
      this.starting = false;
    }
  }

  async cancel(job, status = 'cancelled') {
    if (job.cancellation) return job.cancellation;
    if (job.status !== 'running') return;
    job.status = 'cancelling';
    clearTimeout(job.timer);
    job.cancellation = (async () => {
      try {
        await job.process.dispose();
        job.status = status;
      } catch (error) {
        job.status = 'failed';
        job.error = error.message;
      }
      job.settle();
    })();
    return job.cancellation;
  }

  snapshot(job) {
    const result = { job_id: job.id, status: job.status, created: job.created };
    for (const key of ['answer', 'error', 'exitCode', 'signal']) {
      if (job[key] !== undefined) result[key] = job[key];
    }
    if (['running', 'cancelling'].includes(job.status)) result.next = 'Call status with this job_id and wait_seconds: 30 until terminal. Cancel if no longer needed.';
    if (job.status === 'failed') result.hint = 'Check the native CLI login/configuration and executable path. Raw native diagnostics are not forwarded.';
    return result;
  }

  async dispose() {
    this.closed = true;
    await Promise.all([...this.jobs.values()].map(async job => {
      await this.cancel(job);
      await job.process.dispose();
    }));
  }
}
