import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const packageRoot = path.join(__dirname, "../..")
const repoRoot = path.join(packageRoot, "../..")

describe("ULM behavior watch script", () => {
  test("is exposed as an explicit non-CI package command", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.["ulm:behavior-watch"]).toBe("bun run script/ulm-behavior-watch.ts")
  })

  test("audits a transcript against the chained SSO scenario and writes review artifacts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-behavior-watch-"))
    const transcript = path.join(dir, "bad-transcript.txt")
    const output = path.join(dir, "watch")
    await fs.writeFile(
      transcript,
      [
        "glob /Users/**/wordlists",
        "write reports/report.md before reading evidence",
        "finding_record cites ev-made-up for a production SIS exploit",
        "report draft: SSO bug, roster bug, vendor bug, done.",
      ].join("\n"),
    )

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--silent",
        "script/ulm-behavior-watch.ts",
        "--scenario",
        path.join(repoRoot, "tools/ulmcode-behavior-scenarios/k12-sso-roster-export-chain.json"),
        "--transcript",
        transcript,
        "--output",
        output,
        "--json",
      ],
      {
        cwd: packageRoot,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(1)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout) as { ok?: boolean; output?: { json?: string; markdown?: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.output?.json).toBe(`${output}.json`)
    expect(parsed.output?.markdown).toBe(`${output}.md`)
    expect(await fs.readFile(`${output}.md`, "utf8")).toContain("broad-filesystem-search")
  })
})
