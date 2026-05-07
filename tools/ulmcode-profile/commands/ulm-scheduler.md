---
description: Start or tick the ULMCode runtime scheduler
subtask: true
---

Run scheduler-owned ULMCode progress for the operation below.

Process:
1. call `operation_status` and confirm the full plan and graph exist
2. call `runtime_scheduler` with an appropriate cycle count and supervisor cadence
3. use `runtime_daemon` when wall-clock ownership should persist beyond a single chat turn
4. inspect scheduler heartbeat and supervisor decisions before claiming progress
5. compact only as maintenance; do not let compact stop scheduler ownership

Operation:
$ARGUMENTS
