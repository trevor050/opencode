---
description: Review ULMCode coverage and release blockers
subtask: true
---

Review whether the ULMCode operation below is coverage-ready.

Process:
1. call `operation_status`
2. inspect the coverage contract in `plans/coverage-contract.json`
3. call `operation_next` to see whether coverage, reporting, or scheduler work remains
4. use `operation_run` to continue safe lanes, or mark lanes `skip_lane`/`block_lane` only with durable reasons and honest coverage impact
5. do not treat compacting or skipped release-critical lanes as progress toward handoff

Operation:
$ARGUMENTS
