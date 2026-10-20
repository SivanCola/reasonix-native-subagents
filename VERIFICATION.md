# Verification — 0.1.0 baseline and 0.1.1 repair

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
