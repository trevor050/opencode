import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ReportBundle } from "../../src/report/report"

describe("report bundle", () => {
  test("writes markdown + findings json + run metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Cyber run" })
        await Bun.write(
          path.join(tmp.path, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "### [FND-123] Weak SMB signing",
            "- severity: high",
            "",
            "<!-- finding_json:{\"id\":\"FND-123\",\"title\":\"Weak SMB signing\",\"severity\":\"high\",\"confidence\":0.9,\"asset\":\"dc01.school.local\",\"evidence\":\"SMB signing optional\",\"impact\":\"relay risk\",\"recommendation\":\"enforce SMB signing\",\"safe_reproduction_steps\":[\"Run smb security mode\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const outDir = path.join(tmp.path, "out-report")
        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir,
        })

        expect(result.findingCount).toBe(1)
        expect(await Bun.file(path.join(outDir, "report.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "findings.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "run-metadata.json")).exists()).toBe(true)

        const markdown = await Bun.file(path.join(outDir, "report.md")).text()
        expect(markdown).toContain("Executive Security Report")
        expect(markdown).toContain("Findings by Severity")
        expect(markdown).toContain("Non-Destructive Approach Used")

        const findings = (await Bun.file(path.join(outDir, "findings.json")).json()) as unknown[]
        expect(findings.length).toBe(1)

        const metadata = (await Bun.file(path.join(outDir, "run-metadata.json")).json()) as {
          session_id: string
        }
        expect(metadata.session_id).toBe(session.id)
      },
    })
  })
})
