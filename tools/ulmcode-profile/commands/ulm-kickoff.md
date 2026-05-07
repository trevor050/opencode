---
description: Start a scoped ULMCode pentest operation
subtask: true
---

Start the ULMCode operation described below.

Process:
1. confirm authorization, scope, safety limits, credentials, duration, and report audience
2. call `operation_checkpoint` for the intake state
3. call `operation_plan` only after the required scope questions are actionable
4. for 2h+ runs, require Discovery Charter approval before the full `operation_plan`
5. call `operation_schedule` only after the approved durable plan exists

Operation:
$ARGUMENTS
