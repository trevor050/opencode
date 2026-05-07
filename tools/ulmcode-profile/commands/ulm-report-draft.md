---
description: Draft and lint ULMCode report content
subtask: true
---

Draft or repair report content for the ULMCode operation below.

Process:
1. call `operation_status`
2. call `report_outline` if the outline is missing or inconsistent with the requested report length
3. write or repair `reports/report.md` or `reports/report.html` using recorded evidence only
4. call `report_lint` with outline and finding gates appropriate for the report size
5. keep candidate/rejected findings distinct from report-ready findings

Operation:
$ARGUMENTS
