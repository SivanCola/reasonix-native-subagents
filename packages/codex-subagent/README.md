# Codex subagent / Codex 子智能体

An independent Reasonix Studio Manifest v2 extension. Delegates a complete
text task to your installed, authenticated Codex CLI in the session workspace.
Requires Node.js 20+ on the host PATH and the native CLI. macOS/Linux only;
macOS arm64 verified, Windows unsupported.

Install this directory through Studio's standard extension installer or market.
Use `/codex-subagent:delegate <task>`, or ask the model to use `subagent_codex`.
The tool returns a job ID; query status with wait_seconds=30 until terminal.
Cancellation, a 600-second default deadline, fresh sessions and final-answer
selection are included. No automatic parent wakeup or conversation resume.

Default permission mode: `read-only`.
Set `REASONIX_CODEX_PERMISSION_MODE` in the Reasonix host environment
to enable the desired native permission mode. Optional `REASONIX_CODEX_BIN`,
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

Version: 0.1.0. License: MIT. Maintainer: SivanCola.
[Complete configuration, constraints and source](https://github.com/SivanCola/reasonix-native-subagents)
 · [Report an issue](https://github.com/SivanCola/reasonix-native-subagents/issues)
