---
description: Run a ULMCode supervisor review
subtask: true
---

Run a supervisor review for the ULMCode operation below.

Process:
1. call `operation_status`
2. call `operation_supervise` with the requested review kind, defaulting to heartbeat when unspecified
3. if the decision is `continue_coverage`, continue safe coverage through `operation_next` and `operation_run`
4. if the decision is `continue_reporting`, run report closeout tools before handoff
5. if the decision is `ask_operator`, ask only the specific blocking scope or safety question

Operation:
$ARGUMENTS
