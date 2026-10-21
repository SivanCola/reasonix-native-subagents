# Codex subagent / Codex 子智能体

An independent Reasonix Studio Manifest v2 extension. Delegates a complete
text task to your installed, authenticated Codex CLI in the session workspace.
Requires an installed Node.js 20+ and the native CLI, automatically discovered
from PATH and common Homebrew, user-local, fnm, nvm, Volta, Scoop and asdf locations.
Supports macOS/Linux and Windows x64; Windows 11 ARM64 runs the x64 launcher
under Windows emulation. Windows requires Node 20+ installed in the guest.
Windows verification uses simulated native CLIs in a real Win11 VM; actual
Windows account login and model requests have not been verified.

Install this directory through Studio's standard extension installer or market.
Use `/codex-subagent:delegate <task>`, or ask the model to use `subagent_codex`.
The tool returns a job ID; query status with wait_seconds=30 until terminal.
Cancellation, a 600-second default deadline, fresh sessions and final-answer
selection are included. No automatic parent wakeup or conversation resume.

Default permission mode: `read-only`.
Store settings outside the package at `~/.reasonix/native-subagents/config.json`:
`{"schemaVersion":1,"codex":{"permissionMode":"workspace-write"}}`.
This example enables edits; omit it to retain the default permissions.
Package upgrades never write this file. Optional backend fields: `bin`, `model`,
`timeoutSeconds`. Omit `bin` for automatic discovery.
Existing `REASONIX_CODEX_PERMISSION_MODE` environment settings take priority.
Optional `REASONIX_CODEX_BIN`,
`REASONIX_CODEX_MODEL`, and `REASONIX_CODEX_TIMEOUT_SECONDS`
control the executable, model and deadline. The model cannot change these
through tool arguments. Native configuration and authentication remain in effect.

This is a FULL TRUST sidecar, outside the Reasonix sandbox. It inherits the host
environment. Native tasks may edit files according to native permissions.
Cancel stops processes; it does not roll back changes. Reload cancels in-memory
jobs. Only the newest 16 job results survive within one runtime.

Minimal verification: create nonce.txt with a random value, then delegate
"Read nonce.txt and return only its content; do not modify files."
Expected: completed with the file's exact content. Missing CLI: failed with
executable_not_found. Authentication problems: failed with a stable failure code;
no raw stderr is exposed.

中文：通过扩展市场独立安装。使用现有 Codex 登录与配置执行一次性任务，
支持查询和取消；不会替换主模型。需要 Node.js 20+ 和对应原生 CLI。
取消不回滚已修改文件；重载后任务 ID 不可恢复。默认权限如上，由用户配置，
不能由模型自行放宽。

Version: 0.1.3. License: MIT. Maintainer: SivanCola.
[Complete configuration, constraints and source](https://github.com/SivanCola/reasonix-native-subagents)
 · [Report an issue](https://github.com/SivanCola/reasonix-native-subagents/issues)
