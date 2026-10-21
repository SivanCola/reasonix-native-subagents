# Verification — native subagent extensions

## 0.1.3 Windows support (2026-10-21)

Windows tests execute in a local Windows 11 ARM64 VM with Node 24.19.0 and the
packaged x64 executable through Windows emulation. All 12 Windows tests pass:
both backends discover and invoke real `.cmd` wrappers in paths containing
spaces, Unicode and ampersands; literal stdin and quoted/shell-sensitive model
arguments round-trip; fixtures edit actual code files and validate the result;
malformed responses and invalid configuration fail explicitly. Immediate cancel,
detached descendants, deadline, shutdown and abrupt runtime termination are
checked against actual OS PIDs, with an unrelated process remaining alive.
Copied package replacement preserves the external configuration bytes; Node
startup succeeds with Node absent from PATH through fnm discovery.

The Windows build of Reasonix's actual installer and sidecar client, compiled
from studio commit `8bf2ca8bb1fa3164668fe682b102e9c897c320c1`, also passes both
packages: preview, copied install, extensionless manifest resolution to `.exe`,
handshake, result, code edit, cancel, disable, enable, and removal. These tests
use an isolated Reasonix state directory, not the user's installed extensions.
Before removing a Windows executable, the test asserts its image mapping has
been released (bounded at three seconds); process termination notification alone
does not guarantee immediate file deletion. No destructive uninstall is retried.

**Evidence boundary:** the Windows CLIs are deterministic simulators, not logged-in
Codex or Claude Code. They launch real Windows processes, edit real disposable
files and emit native-format responses, but do not validate authentication,
provider requests, model quality or native permission behavior. Real-model
acceptance from prior versions applies to macOS only. No Windows credentials
were supplied, copied, or published. This boundary is stated in both market
submissions and package READMEs.

The macOS behavior suite retains all 36 regressions. Hosted CI adds Windows x64
Node 20/22 alongside macOS/Linux, plus a clean Go 1.26.5 rebuild that must exactly
match the committed Windows executables. Consult the exact source commit's run
for terminal hosted results.

Configuration schema 1, environment overrides and tool schemas are unchanged.
Existing Windows installs can update the same package names. Per-user settings
remain outside the package. macOS/Linux retain the shell bootstrap; Windows
uses the bundled native bootstrap and system cmd.exe for batch entrypoints.

中文：Win11 虚拟机内的模拟验收已经覆盖真实文件修改、结果返回和子进程树取消，
并通过实际 Reasonix Windows 宿主安装调用链。没有验证 Windows 上真实账号登录和
模型请求；模拟测试不等同于这项证据。配置格式不变，升级不覆盖独立用户配置。

## 0.1.0 baseline (historical)

Local evidence collected on 2026-10-20, macOS arm64, Node.js 26.5.1.

| Boundary | Evidence |
| --- | --- |
| Package assembly | `npm run check`: generated runtime/manifests match source; native entrypoints are executable |
| Automated behavior | 26 Node tests: both result formats, Unicode/literal stdin, multi-megabyte UTF-8 records, private diagnostic exclusion, malformed/oversized output, empty/incomplete answers, concurrent starts, cancellation, wall deadline, missing executable, workspace escape checks, operator-only configuration, descendant cleanup, copied-package protocol handshake |
| Actual Reasonix host | `scripts/host-check.mjs` against `esengine/DeepSeek-Reasonix` studio commit `8bf2ca8bb1fa3164668fe682b102e9c897c320c1`: preview, copied installation, real sidecar handshake, task/result, disable, re-enable, remove — both packages passed |
| Native Codex | CLI 0.163.0 read a random nonce from a disposable workspace and returned its exact value |
| Native Claude Code | CLI 2.1.303 read a random nonce from a disposable workspace and returned its exact value |

Native smoke prompts contain only a filename and read-only instructions. The
expected nonce is never supplied to the model. These tests use the machine's
native authentication/configuration, without publishing credentials or workspace
content. They establish real delegation and file-read behavior, not every
model's code-editing quality.

The host integration uses a deterministic native CLI fixture. Native smoke
tests use the real CLI through the packaged extension protocol. These are
separate layers of evidence.

GitHub Actions runs package consistency and the Node suite on macOS/Linux with
Node.js 20/22. See the run associated with the source commit for hosted results;
local results do not imply hosted CI passed.

The descendant-cleanup check waits for the OS process to stop executing; a
terminated Linux zombie waiting for its adopter to reap it counts as stopped.
It does not require immediate PID disappearance after sending a signal.

Unverified: Windows (unsupported), native calls on Linux, every third-party
provider configuration, subscription-specific limits, and arbitrary global hooks.
Market review is a separate service decision; this document does not claim
approval, recommendation, or public discoverability.

中文：两种原生 CLI 均已完成真实随机文件读取验证；实际 Reasonix 宿主完成
预览、复制安装、调用、启停与卸载验证。自动化测试、真实模型调用、托管 CI
和市场审核是独立证据，不能互相替代。Windows 首版不支持。

## 0.1.1 process cleanup

Actual Studio 2.46.0 acceptance exposed a gap absent from the original fixtures:
Codex created its shell command in a separate process group. Version 0.1.0
returned `cancelled` while that command continued updating a heartbeat file.
Claude Code passed the same scenario. The Codex orphan was explicitly cleaned
up; that cleanup is not counted as a successful cancellation.

The repair tracks observed descendant identities through the OS process table
and terminates descendants even when their process groups differ. Cancellation
stays nonterminal while cleanup runs and reports a failure if cleanup cannot be
verified. Six added regressions cover explicit cancel, timeout and shutdown for
both backends, with a detached descendant and an unrelated-process canary.
All 32 local tests pass. Final real-Studio retest evidence is recorded separately
after installing the repaired packages.

## 0.1.2 durable operator configuration

All 36 local tests pass, including real executable entrypoint startup with a
minimal GUI PATH and a HOME containing spaces, both backend discoveries, copied
package replacement preserving external settings, configuration precedence and
invalid data, numeric Node/CLI version selection and rediscovery after removal.
The existing cancellation/timeout/shutdown regressions remain green.
The real Reasonix installer/sidecar host check passes for both packages.

Studio 2.46.0 replaced both installed 0.1.1 packages with generic 0.1.2 packages
through `install_source` preview/apply with `replace=true`, then reloaded the
session runtime. Installed manifests contain no local environment overrides.
Existing edit modes were migrated to the external configuration file before
replacement; its SHA-256 remained unchanged afterward.

Both actual native CLIs independently repaired new faulty code fixtures through
Studio, ran their tests using plain `node`, and returned `completed` with their
final answers. Independent verification passed all eight tests; test file hashes
were unchanged. No Node/CLI path appeared in the delegated prompts.

| Contract | Previous data | 0.1.2 reader | Previous reader |
| --- | --- | --- | --- |
| Environment overrides | Existing variable names | Still supported; override saved fields | Supported |
| External config schema 1 | Previously absent | Missing file uses defaults; invalid data fails; never rewritten | 0.1.0/0.1.1 ignore it; downgrade needs old explicit configuration |
| Unknown config fields | User-owned | Preserved byte-for-byte; read-only | File untouched |
| Package replacement | Manifest-local overrides lost | Config lives outside install targets | External file untouched but unused |

Native end-to-end evidence is macOS-specific. The hosted macOS/Linux Node 20/22
matrix is reported separately by the source commit's Actions run.
