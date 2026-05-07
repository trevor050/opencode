---
description: Render ULMCode final report deliverables
subtask: true
---

Render final deliverables for the ULMCode operation below.

Process:
1. call `report_lint` before rendering
2. call `report_render`
3. confirm the final package includes HTML, styled PDF, manifest, findings JSON, evidence index, executive summary, technical appendix, operator review, and runtime summary copy
4. call `report_lint` again with `finalHandoff: true`
5. reject legacy text-only PDF output

Operation:
$ARGUMENTS
