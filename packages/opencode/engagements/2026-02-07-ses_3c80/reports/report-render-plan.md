# Report Render Plan - PDF Generation Strategy

**Engagement**: 2026-02-07-ses_3c80  
**Report Type**: Smoke Test Validation  
**Output Target**: report.pdf

## Rendering Approach

### Strategy

The final PDF will be generated using Python-based markdown to PDF rendering with styled layout, ensuring professional presentation suitable for client delivery.

**Tool**: `/packages/opencode/src/report/pdf/generate_report_pdf.py`  
**Input Source**: `reports/report.md` (authored client-facing report)  
**Output**: `reports/report.pdf`

### Styling & Design

#### Document Structure

- **Cover Page**: Title, engagement ID, date, status
- **Table of Contents**: Auto-generated from markdown headings (H2, H3)
- **Body Sections**: Executive summary, scope, findings, recommendations
- **Evidence Pages**: References to subagent results
- **Appendices**: Artifact inventory, timelines, metrics

#### Visual Hierarchy

- **Headings**: Clear H1 (title), H2 (sections), H3 (subsections)
- **Status Indicators**: ✅ PASS, ⚠️ WARN, ❌ FAIL icons for findings
- **Tables**: Findings matrix, metrics, timeline summaries
- **Lists**: Structured with bullet points for readability
- **Code/Evidence Blocks**: Formatted with monospace font for clarity

#### Professional Elements

- **Header/Footer**: Page numbers, engagement ID, date
- **Executive Summary Box**: Highlighted key results at top
- **Findings Matrix**: Severity severity visualization (color-coded if supported)
- **Evidence Links**: Traceable references to source artifacts
- **Recommendation Section**: Clear action items and next steps

### Content Assembly Order

1. **Title & Cover** (Auto-generated)
   - OpenCode Cyber Harness Smoke Test Report
   - Engagement ID, session ID, date
   - Status badge: ✅ PASSED

2. **Table of Contents** (Auto-generated from H2 headings)

3. **Executive Summary** (H2)
   - Quick facts table
   - Key results
   - Recommendation

4. **Scope & Methodology** (H2)
   - What we tested
   - How we tested
   - Constraints and timeline

5. **Operational Status** (H2)
   - Build & runtime (subsections)
   - Repository security
   - Dependency integrity
   - Engagement infrastructure
   - Cyber harness architecture

6. **Findings** (H2)
   - Summary table
   - Detailed findings (each as H3)

7. **Recommendations** (H2)
   - Immediate actions
   - Deeper engagement paths
   - Continuous operations

8. **Evidence & Sources** (H2)
   - Workstream references
   - Artifact locations

9. **Validation Results** (H2)
   - "What Worked / What Didn't" section (harness validation)

10. **Conclusion** (H2)

11. **Appendices** (H2)
    - Appendix A: Artifact locations
    - Appendix B: Timeline
    - Appendix C: Metrics

### Rendering Parameters

**Font & Typography**:

- Body font: Sans-serif (e.g., Helvetica, Arial)
- Heading font: Same family (bold weight)
- Code font: Monospace (e.g., Courier New)
- Size: Body 11pt, headings scaled appropriately

**Page Layout**:

- Paper size: Letter (8.5" × 11")
- Margins: 1" (top, bottom, left, right)
- Line spacing: 1.15 for body text
- Page breaks: Between major sections

**Color & Emphasis**:

- Status indicators: Green for ✅, Red for ❌
- Tables: Alternating row colors for readability (light gray)
- Links: Blue color for evidence references
- Code blocks: Gray background with monospace font

**Images & Diagrams**:

- Findings summary table: Include severity indicators
- Metrics table: Clear column alignment
- Timeline: Simple tabular format
- No complex diagrams (text-only smoke test)

### Quality Assurance

Before finalizing PDF:

1. ✅ Verify markdown structure (all headings present)
2. ✅ Check table of contents generation
3. ✅ Validate page breaks between sections
4. ✅ Confirm status indicators render correctly
5. ✅ Test evidence references are traceable
6. ✅ Ensure professional appearance and readability
7. ✅ Verify all findings appear in findings matrix
8. ✅ Check that appendices are complete

## Implementation Notes

### Markdown Preprocessing

The `report.md` file uses standard markdown format compatible with PDF rendering:

- `# ` for title (H1)
- `## ` for major sections (H2)
- `### ` for subsections (H3)
- `| ` for tables (markdown table format)
- `` ` `` for inline code
- `- ` for lists
- `✅`, `❌`, `⚠️` for status indicators

No special preprocessing required; direct markdown-to-PDF rendering supported.

### Python Rendering

The `generate_report_pdf.py` script handles:

- Markdown parsing (convert to structured document)
- Layout engine (arrange content on pages)
- Styling application (fonts, colors, spacing)
- PDF output generation
- Metadata embedding (title, author, creation date)

### Fallback Strategy

If styled PDF rendering encounters issues:

1. First attempt: Full styled PDF with all formatting
2. Fallback: Simple PDF with basic layout (no color/advanced styling)
3. Text-only backup: Plain text report if PDF fails completely

Current plan uses full styled approach without fallback (unless explicitly requested).

## Validation Criteria

The final PDF must:

- ✅ Contain all content from report.md
- ✅ Be readable and professionally formatted
- ✅ Include table of contents
- ✅ Display findings matrix with severity indicators
- ✅ Reference evidence sources accurately
- ✅ Include cover page with engagement metadata
- ✅ Have proper page numbers and headers
- ✅ Be compatible with standard PDF readers
- ✅ Not exceed 20 pages for smoke test report

## Next Steps

1. ✅ Report.md finalized and validated
2. ⏳ Execute PDF rendering via generate_report_pdf.py
3. ⏳ Validate PDF output meets quality criteria
4. ⏳ Call report_finalize for final bundling and validation

---

**Render Plan Status**: READY FOR EXECUTION  
**Target Format**: Professional client-facing PDF  
**Expected Output**: reports/report.pdf (~8-12 pages)
