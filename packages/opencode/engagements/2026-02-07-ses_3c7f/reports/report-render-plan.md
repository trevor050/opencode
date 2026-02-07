# Report Rendering Plan

**Document**: report.pdf  
**Source**: report.md (client-facing professional report)  
**Format**: HTML/CSS print-to-PDF (headless browser rendering)  
**Target Date**: 2026-02-07

---

## Rendering Strategy

### Approach: HTML/CSS + Headless Browser Print-to-PDF

**Rationale**:

1. **Professional Styling**: CSS enables precise formatting, colors, typography
2. **Reproducible**: Browser print-to-PDF ensures consistent output across runs
3. **No External Dependencies**: Uses standard browser capabilities
4. **Print-Optimized**: CSS print media queries handle page breaks naturally

### Tools

- **HTML Generation**: Convert report.md to styled HTML
- **Rendering**: Headless browser (Chrome/Chromium) via Playwright
- **Output**: PDF via browser print-to-PDF functionality

---

## HTML Structure & Styling

### Page Layout

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Home Network Security Assessment Report</title>
    <style>
      /* Print optimization */
      @page {
        margin: 1in;
      }
      body {
        font-family: "Segoe UI", Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      h1 {
        page-break-before: always;
        color: #003366;
        border-bottom: 3px solid #003366;
        padding-bottom: 10px;
      }
      h2 {
        color: #005088;
        margin-top: 20px;
        margin-bottom: 10px;
      }
      h3 {
        color: #0066aa;
        margin-top: 15px;
      }

      /* Prevent widow/orphan lines */
      p {
        orphans: 3;
        widows: 3;
      }

      /* Tables for findings */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 15px 0;
      }
      th {
        background: #f0f0f0;
        padding: 8px;
        text-align: left;
        border: 1px solid #ddd;
      }
      td {
        padding: 8px;
        border: 1px solid #ddd;
      }

      /* Severity badges */
      .severity-critical {
        background: #8b0000;
        color: white;
        padding: 3px 8px;
        border-radius: 3px;
      }
      .severity-high {
        background: #dc143c;
        color: white;
        padding: 3px 8px;
        border-radius: 3px;
      }
      .severity-medium {
        background: #ff8c00;
        color: white;
        padding: 3px 8px;
        border-radius: 3px;
      }
      .severity-info {
        background: #4169e1;
        color: white;
        padding: 3px 8px;
        border-radius: 3px;
      }

      /* Code blocks */
      pre {
        background: #f5f5f5;
        padding: 12px;
        border-left: 3px solid #0066aa;
        overflow-x: auto;
        font-family: "Courier New", monospace;
      }
      code {
        font-family: "Courier New", monospace;
        background: #f0f0f0;
        padding: 2px 4px;
      }

      /* Recommendations */
      .recommendation {
        background: #e8f4f8;
        padding: 12px;
        border-left: 4px solid #0099cc;
        margin: 10px 0;
      }

      /* Page numbers and header/footer */
      @page {
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
        }
      }
    </style>
  </head>
  <body>
    <!-- Rendered report content -->
  </body>
</html>
```

### Section-by-Section Styling

1. **Cover Page**:
   - Large centered title
   - Subtitle and metadata
   - Executive summary bullets
   - No header/footer on first page

2. **Executive Summary**:
   - Two-column layout for finding distribution table
   - Risk rating prominently displayed
   - Key recommendations highlighted

3. **Findings**:
   - Consistent format for each finding
   - Severity badges with color coding
   - Code blocks for remediation commands
   - Indented technical details

4. **Remediation Roadmap**:
   - Phase-based tables with effort/impact
   - Checkboxes for completion tracking
   - Progress visualization

5. **Appendix**:
   - ASCII diagrams rendered in monospace
   - Evidence file table
   - Risk reduction visualization

---

## HTML Generation Process

### Step 1: Extract Content Sections from report.md

Extract key sections:

- Cover page metadata
- Executive summary
- Finding tables
- Detailed findings (with markdown formatting)
- Remediation roadmap
- Methodology
- Appendix

### Step 2: Convert Markdown to HTML

Apply markdown-to-HTML conversion:

- `# Heading` → `<h1>Heading</h1>`
- `## Heading` → `<h2>Heading</h2>`
- `### Heading` → `<h3>Heading</h3>`
- `**Bold**` → `<strong>Bold</strong>`
- `*Italic*` → `<em>Italic</em>`
- `` `code` `` → `<code>code</code>`
- ` ```bash ... ``` ` → `<pre><code>...</code></pre>`
- Tables (markdown format) → `<table>...</table>`
- Lists → `<ul><li>...</li></ul>` or `<ol><li>...</li></ol>`

### Step 3: Apply CSS Styling

Inject CSS classes for:

- Severity badges: `<span class="severity-high">HIGH</span>`
- Recommendations: `<div class="recommendation">...</div>`
- Code blocks: `<pre><code class="language-bash">...</code></pre>`
- Tables: Alternate row colors for readability

### Step 4: Generate HTML Document

Structure complete HTML document:

- DOCTYPE and meta tags
- Embedded CSS styles
- Report content
- Proper page break markers

---

## PDF Generation Process

### Method 1: Browser Print-to-PDF (Preferred)

Using Playwright (or similar headless browser):

```javascript
async function generatePDF() {
  const page = await browser.newPage()
  await page.goto("file:///path/to/report.html", { waitUntil: "networkidle2" })
  await page.pdf({
    path: "report.pdf",
    format: "A4",
    margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span style="font-size: 10px; margin-left: 20px;"></span>',
    footerTemplate:
      '<span style="font-size: 10px; margin: 0 20px 0 0;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>',
  })
}
```

**Advantages**:

- Professional appearance
- Consistent rendering across platforms
- Proper CSS print support
- Embedded fonts and images

**Output Quality**: HIGH (professional document standard)

### Method 2: Python PDF Generation (Fallback)

If browser PDF fails, use reportlab/PyPDF:

```python
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

# Build PDF from elements
# [Fallback implementation]
```

**Advantages**:

- No browser dependency
- Programmatic control

**Disadvantages**:

- Less styling flexibility
- Manual page break handling
- Basic formatting

---

## CSS Print Optimization

### Page Layout Optimization

```css
/* Prevent widows and orphans */
p {
  orphans: 3;
  widows: 3;
}
table {
  page-break-inside: avoid;
}
h1,
h2,
h3 {
  page-break-after: avoid;
}

/* Optimal page breaks */
.finding {
  page-break-inside: avoid;
}
.phase-section {
  page-break-inside: avoid;
}

/* Margins for print */
@page {
  margin: 1in;
  size: A4;
}

/* Remove screen-only elements */
@media print {
  .no-print {
    display: none;
  }
  a {
    text-decoration: none;
    color: black;
  }
}
```

### Font Stack

```css
body {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt; /* Print-friendly size */
  line-height: 1.5;
}

h1 {
  font-size: 24pt;
  font-weight: bold;
}
h2 {
  font-size: 16pt;
  font-weight: bold;
}
h3 {
  font-size: 13pt;
  font-weight: bold;
}

code,
pre {
  font-family: "Courier New", "Consolas", monospace;
  font-size: 9pt;
}
```

### Color Palette (Print-Safe)

```css
/* Primary colors (print-friendly) */
--primary-dark: #003366; /* Dark blue */
--primary-light: #0066aa; /* Medium blue */
--accent-warm: #ff8c00; /* Orange */

/* Status colors */
--severity-critical: #8b0000; /* Dark red */
--severity-high: #dc143c; /* Crimson */
--severity-medium: #ff8c00; /* Orange */
--severity-info: #4169e1; /* Royal blue */

/* Neutral colors */
--text: #333333; /* Dark gray (print-safe) */
--border: #cccccc; /* Light gray */
--background: #f5f5f5; /* Very light gray */
```

---

## Page Structure

### Estimated Page Layout

```
Page 1:       Cover page + metadata
Pages 2-3:    Executive Summary + Key Findings Table
Pages 4-8:    Detailed Findings (HIGH severity, then MEDIUM, then INFO)
Pages 9-10:   Remediation Roadmap (Phase 1, 2, 3)
Pages 11:     Methodology
Pages 12-13:  Appendix (diagrams, tables, evidence index)

Total: ~13 pages (professional length)
```

### Page Breaks Strategy

Insert page breaks (`<div style="page-break-before: always;"></div>`) before:

- Each severity section (HIGH → MEDIUM → INFO)
- Remediation Roadmap
- Appendix sections

Allow natural page breaks within:

- Executive Summary
- Finding details
- Appendix tables

---

## Quality Assurance Checklist

**Pre-PDF Checks**:

- [ ] report.md is complete and polished
- [ ] All headings and formatting are correct
- [ ] All links and references are valid
- [ ] Evidence file paths are accurate
- [ ] Tables render correctly

**HTML Generation**:

- [ ] All markdown converted to valid HTML
- [ ] CSS classes applied to severity badges
- [ ] Code blocks properly formatted
- [ ] Images/diagrams included if applicable

**PDF Rendering**:

- [ ] PDF generated successfully from HTML
- [ ] All pages render correctly
- [ ] Text is readable (minimum 10pt font)
- [ ] Tables fit within page margins
- [ ] Page numbers appear correctly
- [ ] Colors print correctly (or convert to grayscale)
- [ ] No content is cut off or wrapped poorly

**Final Review**:

- [ ] Professional appearance suitable for client
- [ ] All findings are clearly visible
- [ ] Remediation steps are easy to follow
- [ ] Evidence references are present
- [ ] No sensitive data exposed
- [ ] File size is reasonable (<5 MB)

---

## Technical Implementation

### Tools Required

1. **Playwright** (or similar):

   ```bash
   npm install playwright
   ```

2. **Markdown Parser** (optional, if needed):

   ```bash
   npm install markdown-it
   ```

3. **Browser** (Chromium):
   - Included with Playwright
   - Or use system-installed Chrome/Edge

### Execution Command

```bash
# Generate HTML from report.md (if needed)
node generate-html.js reports/report.md reports/report.html

# Generate PDF from HTML
node generate-pdf.js reports/report.html reports/report.pdf

# Or single command:
node generate-report-pdf.js reports/report.md reports/report.pdf
```

### Fallback Procedure

If browser PDF generation fails:

1. Attempt to use system `wkhtmltopdf` if available
2. Fall back to Python reportlab PDF generation
3. If all fail, deliver HTML + instructions for user to print

---

## Output Specification

### PDF Document Properties

- **Filename**: `report.pdf`
- **Location**: `reports/report.pdf`
- **Format**: PDF/A-1b (archival standard, optional)
- **Compression**: Standard (balance file size vs. quality)
- **Page Size**: A4 (210mm × 297mm)
- **Margins**: 1 inch (25.4mm) all sides
- **Font Embedding**: Automatic (all fonts embedded)

### Delivery Checklist

- [ ] report.pdf created successfully
- [ ] File size < 5 MB
- [ ] All pages render correctly
- [ ] Text is searchable (embedded fonts)
- [ ] Print quality is professional
- [ ] No watermarks or artifacts
- [ ] Ready for client delivery

---

## Version Control

- **report.md**: Version FINAL (polished client report)
- **report.html**: Generated from report.md
- **report.pdf**: Generated from report.html
- **All artifacts**: Located in `reports/` directory

---

## Timeline

1. **Create report.md**: ✅ Complete (polished client report)
2. **Generate report.html**: ⏳ Ready (conversion process)
3. **Generate report.pdf**: ⏳ Ready (browser rendering)
4. **Final validation**: ⏳ Ready (QA checklist)
5. **Client delivery**: ⏳ Ready (finalization)

---

## Success Criteria

✅ Professional appearance suitable for C-level stakeholders  
✅ All findings clearly presented with evidence references  
✅ Remediation steps are easy to follow  
✅ PDF renders correctly on Windows, macOS, and Linux  
✅ File size is reasonable (< 5 MB)  
✅ Ready for email delivery and printing

---

**Rendering Plan Status**: READY FOR IMPLEMENTATION  
**Next Step**: Generate report.html and report.pdf
