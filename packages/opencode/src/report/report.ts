import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"

export namespace ReportBundle {
  export const Finding = z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    confidence: z.number().min(0).max(1),
    asset: z.string(),
    evidence: z.string(),
    impact: z.string(),
    recommendation: z.string(),
    safe_reproduction_steps: z.array(z.string()),
    non_destructive: z.literal(true),
  })
  export type Finding = z.infer<typeof Finding>

  export const RunMetadata = z.object({
    session_id: z.string(),
    generated_at: z.string(),
    model: z.object({
      provider_id: z.string().nullable(),
      model_id: z.string().nullable(),
    }),
    overrides_used: z.object({
      sensitive_bash_commands_executed: z.number().int().nonnegative(),
      note: z.string(),
    }),
  })
  export type RunMetadata = z.infer<typeof RunMetadata>

  function parseFindingComments(markdown: string): Finding[] {
    const findings: Finding[] = []
    const regex = /<!--\s*finding_json:(\{.*?\})\s*-->/g
    for (const match of markdown.matchAll(regex)) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>
        const normalized = Finding.parse({
          ...parsed,
          safe_reproduction_steps: Array.isArray(parsed.safe_reproduction_steps) ? parsed.safe_reproduction_steps : [],
          non_destructive: true,
        })
        findings.push(normalized)
      } catch {
        // keep parsing other findings even if one malformed block exists
      }
    }
    return findings
  }

  function summarizeBySeverity(findings: Finding[]) {
    return findings.reduce<Record<Finding["severity"], number>>(
      (acc, finding) => {
        acc[finding.severity] += 1
        return acc
      },
      { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    )
  }

  function sortBySeverity(findings: Finding[]) {
    const rank: Record<Finding["severity"], number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    }
    return [...findings].sort((a, b) => {
      if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity]
      return b.confidence - a.confidence
    })
  }

  function renderMarkdown(input: {
    session: Session.Info
    findings: Finding[]
    findingLog: string
    metadata: RunMetadata
  }) {
    const sorted = sortBySeverity(input.findings)
    const bySeverity = summarizeBySeverity(sorted)

    const findingsSection =
      sorted.length === 0
        ? "_No structured findings parsed from finding.md yet._"
        : sorted
            .map((finding) =>
              [
                `### [${finding.id}] ${finding.title}`,
                `- Severity: ${finding.severity}`,
                `- Confidence: ${finding.confidence}`,
                `- Asset: ${finding.asset}`,
                "",
                "#### Impact",
                finding.impact,
                "",
                "#### Recommendation",
                finding.recommendation,
                "",
                "#### Safe Reproduction Steps",
                ...finding.safe_reproduction_steps.map((step, i) => `${i + 1}. ${step}`),
                "",
              ].join("\n"),
            )
            .join("\n")

    return [
      "# Executive Security Report",
      "",
      "## Executive Summary",
      `- Session: ${input.session.id}`,
      `- Generated: ${input.metadata.generated_at}`,
      `- Structured findings: ${sorted.length}`,
      `- Severity counts: critical=${bySeverity.critical}, high=${bySeverity.high}, medium=${bySeverity.medium}, low=${bySeverity.low}, info=${bySeverity.info}`,
      "",
      "## Scope and Methodology",
      "- Internal authorized engagement workflow",
      "- Non-destructive-first assessment posture",
      "- Evidence-backed validation with reproducible artifacts",
      "",
      "## Findings by Severity",
      findingsSection,
      "",
      "## Non-Destructive Approach Used",
      "- Default non-destructive posture was applied.",
      "- Any sensitive/destructive-like command path required explicit interactive approval.",
      "",
      "## Evidence Appendix",
      "```markdown",
      input.findingLog.trim(),
      "```",
      "",
    ].join("\n")
  }

  function detectModel(messages: MessageV2.WithParts[]) {
    const lastAssistant = [...messages].reverse().find((msg) => msg.info.role === "assistant")
    if (lastAssistant && lastAssistant.info.role === "assistant") {
      return {
        provider_id: lastAssistant.info.providerID,
        model_id: lastAssistant.info.modelID,
      }
    }
    const lastUser = [...messages].reverse().find((msg) => msg.info.role === "user")
    if (lastUser && lastUser.info.role === "user") {
      return {
        provider_id: lastUser.info.model.providerID,
        model_id: lastUser.info.model.modelID,
      }
    }
    return {
      provider_id: null,
      model_id: null,
    }
  }

  function countSensitiveBashExecutions(messages: MessageV2.WithParts[]) {
    let count = 0
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "bash") continue
        if (part.state.status !== "completed") continue
        const risk = part.state.metadata?.bash_risk
        if (risk?.level === "sensitive") count += 1
      }
    }
    return count
  }

  async function latestSessionID() {
    let latest: Session.Info | undefined
    for await (const session of Session.list()) {
      if (session.parentID) continue
      if (!latest || session.time.updated > latest.time.updated) latest = session
    }
    if (!latest) throw new Error("No sessions found")
    return latest.id
  }

  export const generate = async (input: { sessionID?: string; outDir: string }) => {
    const sessionID = input.sessionID ?? (await latestSessionID())
    const session = await Session.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)

    const findingPath = path.join(session.directory, "finding.md")
    const findingLog = await fs
      .readFile(findingPath, "utf8")
      .catch(() => Promise.reject(new Error(`finding.md not found at ${findingPath}`)))

    const messages = await Session.messages({ sessionID: session.id })
    const model = detectModel(messages)
    const metadata = RunMetadata.parse({
      session_id: session.id,
      generated_at: new Date().toISOString(),
      model,
      overrides_used: {
        sensitive_bash_commands_executed: countSensitiveBashExecutions(messages),
        note: "Sensitive command execution count inferred from bash tool metadata (interactive approvals are runtime-scoped).",
      },
    })

    const findings = parseFindingComments(findingLog)
    const markdown = renderMarkdown({
      session,
      findings,
      findingLog,
      metadata,
    })

    await fs.mkdir(input.outDir, { recursive: true })
    const reportPath = path.join(input.outDir, "report.md")
    const findingsPath = path.join(input.outDir, "findings.json")
    const metadataPath = path.join(input.outDir, "run-metadata.json")

    await Promise.all([
      fs.writeFile(reportPath, markdown),
      fs.writeFile(findingsPath, JSON.stringify(findings, null, 2) + "\n"),
      fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n"),
    ])

    return {
      sessionID: session.id,
      outDir: input.outDir,
      reportPath,
      findingsPath,
      metadataPath,
      findingCount: findings.length,
    }
  }
}
