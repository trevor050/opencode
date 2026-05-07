---
description: Advance the next ULMCode operation lane
subtask: true
---

Advance the next safe unit of work for the ULMCode operation below.

Process:
1. call `operation_next`
2. call `runtime_scheduler` for 1h+ approved operations when scheduler ownership should continue
3. otherwise call `operation_run` with `advance`
4. launch returned model lanes with `task` and returned command profiles with `command_supervise`
5. complete lanes only with concrete artifacts and evidence references where required

Operation:
$ARGUMENTS
