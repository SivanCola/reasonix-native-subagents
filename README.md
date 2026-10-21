# Native subagents for Reasonix Studio

Two independent Manifest v2 extensions that let Reasonix delegate a
self-contained task to an existing Codex or Claude Code installation.

| Extension | Tool | Slash command |
| --- | --- | --- |
| [Codex subagent](packages/codex-subagent) | `subagent_codex` | `/codex-subagent:delegate` |
| [Claude Code subagent](packages/claude-code-subagent) | `subagent_claude_code` | `/claude-code-subagent:delegate` |

Install either package independently through Studio's extension market, or
preview its commit-pinned GitHub directory in the standard plugin installer.
No Reasonix core changes, npm dependency installation, remote scripts, or
automatic native CLI downloads are required.

## Requirements

- Reasonix Studio with Manifest v2 and runtime tool support.
- An installed Node.js 20 or later (automatically discovered even with a minimal GUI PATH).
- The corresponding native CLI installed and authenticated on the machine
  running the Reasonix session. A remote session requires these on its remote
  host, not only on the desktop computer.
- macOS, Linux or Windows x64. Windows support starts with 0.1.3.
  Windows 11 ARM64 uses the bundled x64 launcher's OS emulation.
  macOS arm64 has real-model acceptance; Windows 11 ARM64 has guest-OS tests
  with simulated Codex/Claude CLIs. Windows login and real-model delegation
  are not established by these simulated tests; see `VERIFICATION.md`.
- Native compatibility verified with Codex CLI 0.163.0 and Claude Code 2.1.303.
  Other CLI versions must support the documented flags and JSON events.

Authentication, account usage, model defaults, project instructions, native
MCPs, and native hooks belong to the respective CLI. This extension does not
log in, change subscriptions, replace Reasonix's primary model, or import
Reasonix conversation history. Native hooks/settings remain effective.

## Use

For example, ask:

> Use the Codex subagent to inspect the parser in this workspace and report
> the cause of the failing empty-input case. Do not change files.

Or invoke `/claude-code-subagent:delegate` with a complete task.
The model finds the tool through `use_capability`; its capability identifier is
`tool:ext__codex-subagent__subagent_codex` or
`tool:ext__claude-code-subagent__subagent_claude_code`.

```json
{"action":"start","task":"Read src/parser.ts and explain its empty-input behavior."}
```

The response contains a `job_id`. Poll it until terminal:

```json
{"action":"status","job_id":"RETURNED_JOB_ID","wait_seconds":30}
```

Cancel unnecessary work:

```json
{"action":"cancel","job_id":"RETURNED_JOB_ID"}
```

The terminal states are `completed`, `failed`, `timed_out`, and `cancelled`.
`cancelling` is nonterminal while process cleanup is being verified.
Only `completed` contains an answer. Partial assistant text, reasoning, raw
native stderr, and usage events are not returned as answers. Failure responses
contain a stable code and process exit status when available.

## Configuration

Save operator settings in `~/.reasonix/native-subagents/config.json`, outside
both installed packages. Package upgrades and reinstalls never write this file.
Settings are read on every new job. For example, to retain edit permissions:

```json
{
  "schemaVersion": 1,
  "codex": { "permissionMode": "workspace-write" },
  "claude": { "permissionMode": "acceptEdits" }
}
```

Optional fields inside each backend are `bin`, `model` and `timeoutSeconds`.
Omit `bin` to automatically find the installed CLI. No credentials belong in
this file; each CLI continues using its native login and settings.
Missing configuration keeps the conservative defaults. Malformed/unreadable
files and unsupported schema versions fail explicitly. Unknown fields are
preserved because extensions only read the file, never rewrite it.

Existing environment variables take priority over the corresponding saved
field. These values are operator
configuration; the model cannot select executables, inject environment
variables, choose a model, or raise permissions through tool arguments.

| Setting | Codex | Claude Code |
| --- | --- | --- |
| Native executable | `REASONIX_CODEX_BIN` (default `codex`) | `REASONIX_CLAUDE_BIN` (default `claude`) |
| Optional model override | `REASONIX_CODEX_MODEL` | `REASONIX_CLAUDE_MODEL` |
| Permissions | `REASONIX_CODEX_PERMISSION_MODE` | `REASONIX_CLAUDE_PERMISSION_MODE` |
| Wall timeout, seconds | `REASONIX_CODEX_TIMEOUT_SECONDS` | `REASONIX_CLAUDE_TIMEOUT_SECONDS` |

The executable launcher locates Node through PATH or common Homebrew,
user-local, fnm, nvm, Volta and asdf installations without evaluating shell
startup files. With no working Node on PATH, it selects the newest compatible
installed version. CLI discovery searches absolute PATH entries, the user-local
bin directory, the running Node directory, Homebrew and version-manager locations.
This follows stable CLI links and detects newly installed Node versions on
runtime restart. It does not install missing software.

For unusual layouts, place an absolute Node executable path on one line in
`~/.reasonix/native-subagents/node-path`, or use `REASONIX_SUBAGENT_NODE`
(environment takes priority). Invalid explicit Node overrides fail instead of
silently choosing another Node. `REASONIX_SUBAGENT_CONFIG_DIR` can redirect the
whole configuration directory to another absolute path. Reload the runtime
after changing Node selection. CLI `bin` overrides name an executable, never
a shell command; prefer absolute paths.

For upgrades from 0.1.0/0.1.1, move your manifest's permission/model/timeout
customizations into this file before installing 0.1.2, and omit stale PATH/BIN
overrides to use discovery. Old versions ignore this external file; downgrading
requires configuring the old version explicitly. No automatic migration writes
or deletes user settings. Do not customize the installed manifest anymore.
The timeout defaults to 600 seconds, with a range of 1–3600 seconds.

### Windows

The same two packages now include a native `runtime/launch.exe`. The manifest
uses extensionless `runtime/launch`: Reasonix's Windows exec resolution selects
the `.exe`, while macOS/Linux execute the packaged shell entrypoint.
No Git Bash, shell profile, machine-specific manifest edit or runtime download
is required. This is an unsigned community executable built from the included
Go source; its source and executable SHA-256 are in `runtime/launch.build.json`.

Install Node.js 20+ and authenticate the desired CLI in the same Windows user
account that runs Studio. Node discovery checks PATH, the standard Node
installation, fnm, nvm-windows, Volta and Scoop locations. CLI discovery includes
the Node directory, `%APPDATA%\npm`, `%USERPROFILE%\.local\bin`, version-manager
directories, and `.exe`/`.cmd`/`.bat`/`.com` suffixes. npm `.cmd` wrappers run
through the system cmd.exe with escaped arguments; the task remains literal stdin.
The task cannot set an executable, command line or permission mode.

Settings live at `%USERPROFILE%\.reasonix\native-subagents\config.json` and use
the same schema and environment overrides as macOS/Linux. An optional `node-path`
file in that directory must contain an absolute `node.exe` path. No credentials
are copied between operating systems. Replacing either package preserves this
directory. Invalid explicit overrides fail rather than silently changing programs.

Each Windows task runs under a dedicated Job Object before any native child
starts. Cancel and timeout terminate the whole job and verify its active process
count reaches zero. Closing or killing the runtime closes its outer job, also
terminating its task trees. Unrelated processes are outside these jobs. This
is process lifecycle management, not a sandbox or rollback mechanism.

中文：0.1.3 开始支持 Windows，包含原生启动器、Node/CLI 自动发现、npm `.cmd`
入口及 Job Object 子进程树清理。配置独立于安装目录，保存于
`%USERPROFILE%\.reasonix\native-subagents\config.json`。Windows 验收使用真实
Win11 中的模拟 CLI，确实改文件和启动/终止子进程；不代表已经验证真实账号登录或模型请求。

- Codex defaults to `read-only` with approvals set to `never`.
  Other supported modes are `workspace-write` (also no interactive approval)
  and `approve-for-me` (native automatic review). No sandbox bypass mode is exposed.
- Claude Code defaults to `dontAsk`, which denies operations requiring
  new permission but respects native existing grants. This is **not** a
  read-only guarantee. Other supported modes are `acceptEdits`, `plan`,
  and `auto`. `AskUserQuestion` is disabled. No bypass mode is exposed.

For edit tasks, explicitly choose the native permission mode that permits the
requested work. Native permissions remain distinct from Reasonix's tool-call
permission check. Do not assume Reasonix's sandbox confines a full-trust sidecar.

## Lifecycle and boundaries

- Each start creates a new native process and non-persistent conversation.
  Codex uses `exec --json --ephemeral`; Claude uses
  `--print --output-format stream-json --no-session-persistence`.
- Tasks operate in the host-provided workspace, or a real subdirectory of it.
  Traversal and symlink escapes in `cwd` are rejected. This validates the
  starting directory; the native product controls subsequent filesystem access.
- One active native task per extension instance. Two extensions or multiple
  Reasonix sessions can still operate concurrently: coordinate file ownership.
- Completion is collected by polling. There is no automatic parent-session
  wakeup, resumed conversation, or interactive approval bridge.
- Jobs are in memory; the newest 16 are retained. Reload, shutdown, disable,
  or removal ends the sidecar and cancels its tasks. IDs from an old runtime
  return `unknown_job`; they cannot resume work.
- On macOS/Linux, normal cancellation/shutdown tracks observed native descendants, including
  separate process groups, and escalates after 500 ms. A terminal cancellation
  is returned only after those processes stop executing; cleanup failures are
  explicit failures. The process table is sampled every 200 ms and immediately
  before termination. This is lifecycle management, not containment of deliberate
  daemonization that escapes observation. An abrupt OS kill of the sidecar cannot guarantee cleanup.
  Cancellation does not roll back file edits or external actions.
- Task input is limited to 48 KiB, native stdout to 16 MiB, and the selected
  answer to 128 KiB. Overflow is an explicit failure, never silent success.
- No parent transcript is injected and no timestamp or job state is inserted
  into the model's tool schemas or system prompt.

**Trust:** these are full-trust code extensions. They inherit the host's
environment and native credentials/settings and launch native coding agents.
They do not store credentials in their package or forward raw native diagnostics.
They intentionally do not sanitize the native environment into a security sandbox.
Review the ordinary Studio installation preview before installation.

## Development and verification

```sh
npm run build
npm test
npm run check
node scripts/host-check.mjs /path/to/DeepSeek-Reasonix
node scripts/smoke.mjs codex
node scripts/smoke.mjs claude
```

The last two commands make real, separately billed native model calls. They
create a disposable workspace, write a random nonce absent from the prompt,
and verify the native agent actually reads it.

`host-check` temporarily adds a test to a matching Reasonix checkout and
removes it on completion. It exercises the real install preview/apply, copied
package loading, host handshake, tool calls, enable/disable and removal using
a deterministic fake native CLI. Pass an optional pinned GitHub
`.../tree/FULL_COMMIT/packages` root to test remote installation.

`packages/*` are self-contained distribution directories. Runtime copies are
generated from `src` by `scripts/build.mjs`; `npm run check` detects drift.
Do not publish a package without its executable entrypoint bit.

See [verification evidence](VERIFICATION.md) for the release-specific results.
Maintainer: [SivanCola](https://github.com/SivanCola).
Report problems through this repository's issue tracker.

## Relationship to DeepSeek Harness

This is an independent Reasonix implementation of the one-shot native
delegation workflow described in DeepSeek Harness's
[Codex](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent/subagent-codex)
and [Claude Code](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent/subagent-claude-code)
plugins. No upstream source was copied. It uses installed native CLIs instead
of bundled Codex app-server / Claude Agent SDK payloads, and Reasonix capability
tools instead of the Harness subagent service. It does not claim those products'
endorsement or exact feature parity.

## 中文

这两个包分别是 **Codex 子智能体**和 **Claude Code 子智能体**，均通过
Reasonix Studio 的扩展市场独立安装、启停和卸载，无需修改 Studio 内核。

需要运行会话的机器安装 Node.js 20+，以及已经登录、可用的对应原生 CLI。
原生 CLI 的模型、认证、MCP、钩子和项目设置继续有效；用量由该 CLI 配置的
账户或 API 承担。支持 macOS/Linux，以及 0.1.3 起的 Windows；Windows 验证范围见上文。

可使用 `/codex-subagent:delegate 任务内容` 或
`/claude-code-subagent:delegate 任务内容`，也可直接要求主智能体调用对应能力。
每个任务会启动全新会话；主智能体拿到任务 ID 后查询到完成，再汇总结果。
支持取消和超时，不支持继续子会话或自动唤醒父会话。

默认 Codex 使用只读沙箱，Claude Code 使用 `dontAsk`（沿用已有授权，
不等同于只读）。需要改代码时，由用户设置上述 `PERMISSION_MODE` 环境变量。
工具参数不能自行更改权限。每个扩展实例同时运行一个任务，两个扩展仍需避免
同时修改同一文件。

扩展属于 **FULL TRUST**，原生进程会继承宿主环境与凭据；起始目录校验不等于
完整文件访问沙箱。取消只停止进程，不撤销已完成的修改。任务记录只在内存中
保留最近 16 条；重载、关闭或移除扩展会终止任务，原任务 ID 不可恢复。

本实现借鉴 Harness 的委派方式，使用用户已安装的 CLI 和 Reasonix 扩展协议，
不包含 Harness 上游代码，也不是 DeepSeek、OpenAI 或 Anthropic 的官方扩展。
