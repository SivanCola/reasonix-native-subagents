---
description: Delegate one task to Codex and collect its result
argument-hint: <self-contained task>
---

Delegate the following task to the installed subagent_codex extension capability.
Discover it through use_capability, then call action=start with a complete task.
Poll action=status with the returned job_id and wait_seconds=30 until terminal.
Do not rerun start to check progress. Cancel it if the task is no longer wanted.
Report a failure honestly; independently verify requested file changes before claiming completion.
Do not send secrets or unrelated conversation history. Do not change native permission settings.

Task:
$ARGUMENTS
