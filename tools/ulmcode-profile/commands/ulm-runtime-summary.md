---
description: Refresh ULMCode runtime accounting
subtask: true
---

Refresh runtime accounting for the ULMCode operation below.

Process:
1. call `task_list` with the operation ID
2. call `runtime_summary`
3. confirm background tasks, model calls, usage, compaction pressure, repeated fetches, and restart metadata are represented
4. resolve runtime blind spots before final handoff
5. call `operation_status` to confirm `runtimeSummary` is detected

Operation:
$ARGUMENTS
