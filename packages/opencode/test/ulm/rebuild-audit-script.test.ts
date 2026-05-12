import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const packageRoot = import.meta.dir + "/../.."

async function writeFixtureFile(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function makeAuditFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-rebuild-audit-"))
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/package.json",
    JSON.stringify({
      dependencies: {
        "@opencode-ai/plugin": "1.14.38",
      },
    }),
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/opencode.json",
    JSON.stringify({ plugin: ["plugins/ulmcode-runtime-guard.js"] }),
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js",
    "operation_resume runtime_summary operation_recover report_lint",
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/scripts/install-profile.sh",
    'cp ulmcode-launch.sh tool-manifest.json\nrm -f "$TARGET_DIR/oh-my-openagent.jsonc"\nrm -f "$TARGET_DIR/.opencode/oh-my-openagent.jsonc"',
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/README.md",
    [
      "# ULMCode Profile",
      "",
      "## First School Laptop Run",
      "- Use the `school-laptop-48h` operation template.",
      "- Run `ulm:first-run-rehearsal` before creating the real operation.",
      "- Run `ulm:first-run-objective-audit` before calling the system ready.",
      "- Run `ulm:laptop-preflight` before launch.",
      "- Run `ulm:wall-clock-canary` on the laptop before trusting the long window.",
      "- Run `launchReadiness` with `--require-launch-ready` immediately before daemon launch.",
      "- Start the daemon with `--duration-hours 48`.",
      "- Check literal readiness with `ulm:literal-run-readiness`.",
      "- Run bounded live probes with `ulm:behavior-probe`.",
    ].join("\n"),
  )
  await writeFixtureFile(
    root,
    "packages/opencode/package.json",
    JSON.stringify({
      scripts: {
        "test:ulm-harness:fast": "bun run script/ulm-harness-run.ts --tier fast",
        "test:ulm-harness:overnight": "bun run script/ulm-harness-run.ts --tier overnight",
      },
    }),
  )
  await writeFixtureFile(
    root,
    ".github/workflows/ulm-harness.yml",
    [
      "name: ulm-harness",
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 9 * * *\"",
      "jobs:",
      "  overnight:",
      "    steps:",
      "      - run: bun run --cwd packages/opencode test:ulm-harness:overnight",
    ].join("\n"),
  )
  return root
}

async function writeToolManifest(root: string, commandProfiles: unknown[]) {
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/tool-manifest.json",
    JSON.stringify(
      {
        version: 1,
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
        },
        tools: [
          {
            id: "nmap",
            purpose: "service inventory and version fingerprinting",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sV -oA {outputPrefix} {target}"],
            outputParsers: ["xml"],
            fallbacks: ["httpx"],
          },
          {
            id: "httpx",
            purpose: "HTTP discovery and inventory",
            safety: "non_destructive",
            install: [{ platform: "go", command: "go install httpx" }],
            validate: "httpx -version",
            safeExamples: ["httpx -l hosts.txt -json -o {outputPrefix}.jsonl"],
            outputParsers: ["jsonl"],
            fallbacks: ["curl"],
          },
          {
            id: "ffuf",
            purpose: "authorized content discovery",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install ffuf" }],
            validate: "ffuf -V",
            safeExamples: ["ffuf -u {url}/FUZZ -w {wordlist} -o {outputPrefix}.json"],
            outputParsers: ["json"],
            fallbacks: ["manual-review"],
          },
          {
            id: "zap-baseline",
            purpose: "passive web baseline checks",
            safety: "non_destructive",
            install: [{ platform: "docker", command: "docker pull zaproxy/zap-stable" }],
            validate: "docker image inspect zaproxy/zap-stable",
            safeExamples: ["zap-baseline.py -t {url} -J {outputPrefix}.json"],
            outputParsers: ["json"],
            fallbacks: ["manual-browser-review"],
          },
        ],
        commandProfiles,
      },
      null,
      2,
    ),
  )
}

async function git(root: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`)
  return stdout.trim()
}

async function makeUpstreamFixture(commitMessage: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-rebuild-upstream-"))
  await git(root, ["init", "-b", "main"])
  await git(root, ["config", "user.email", "test@example.com"])
  await git(root, ["config", "user.name", "Test User"])
  await writeFixtureFile(root, "README.md", "base\n")
  await git(root, ["add", "README.md"])
  await git(root, ["commit", "-m", "base"])
  await git(root, ["checkout", "-b", "upstream/dev"])
  await writeFixtureFile(root, "UPSTREAM.md", `${commitMessage}\n`)
  await git(root, ["add", "UPSTREAM.md"])
  await git(root, ["commit", "-m", commitMessage])
  await git(root, ["checkout", "main"])
  return root
}

async function addUpstreamCommit(root: string, commitMessage: string, file: string) {
  await git(root, ["checkout", "upstream/dev"])
  await writeFixtureFile(root, file, `${commitMessage}\n`)
  await git(root, ["add", file])
  await git(root, ["commit", "-m", commitMessage])
  await git(root, ["checkout", "main"])
}

describe("ULM rebuild audit script", () => {
  test("validates the rebuild evidence checklist", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "test:ulm-rebuild-audit"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("ulm_rebuild_audit: ok")
    expect(stdout).toContain("upstream_current: ok")
    expect(stdout).toContain("operation_runtime: ok")
    expect(stdout).toContain("report_quality: ok")
    expect(stdout).toContain("profile_routing: ok")
    expect(stdout).toContain("profile_runtime: ok")
    expect(stdout).toContain("lab_catalog: ok")
    expect(stdout).toContain("required_gates: ok")
  })

  test("prints a machine-readable rebuild checklist as JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--json"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const result = JSON.parse(stdout) as {
      ok?: boolean
      checkedAt?: string
      checks?: Array<{ id?: string; status?: string; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(typeof result.checkedAt).toBe("string")
    expect(result.checks?.map((check) => check.id)).toEqual([
      "upstream_current",
      "operation_runtime",
      "report_quality",
      "profile_routing",
      "profile_runtime",
      "lab_catalog",
      "required_gates",
      "harness_scheduler",
      "behavior_scenarios",
    ])
    expect(result.checks?.every((check) => check.status === "ok" && typeof check.detail === "string")).toBe(true)
  })

  test("requires rebuild audit coverage for operation scope rules in lane prompts", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain('requireText("packages/opencode/src/ulm/operation-run.ts", operationRun')
    expect(source).toContain('requireText("packages/opencode/src/ulm/operation-next.ts", operationNext')
    expect(source).toContain("readOperationScopeRules")
    expect(source).toContain("Operation scope rules:")
    expect(source).toContain("includes operation plan scope rules in launched lane prompts")
    expect(source).toContain("includes operation plan scope rules in next lane prompts")
  })

  test("requires rebuild audit coverage for refreshed credential service expectations", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain('requireText("packages/opencode/src/ulm/operation-credentials.ts"')
    expect(source).toContain("expectedServices: expectedServices.length ? expectedServices : submission.expectedServices")
    expect(source).toContain('requireText("packages/opencode/test/ulm/operation-credentials.test.ts"')
    expect(source).toContain("refreshes expected credential services when the plan changes after review submission")
  })

  test("requires rebuild audit coverage for negated credential service labels", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("hasNonNegatedCredentialService")
    expect(source).toContain("does not treat negated service labels as credential coverage")
  })

  test("requires rebuild audit coverage for current credential checks in selected preflight proof", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("current_credential_gaps")
    expect(source).toContain("does not accept a ready selected laptop preflight when current credential coverage is missing")
  })

  test("requires rebuild audit coverage for objective-audit launch next actions", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("first-run-next-actions.json")
    expect(source).toContain("writes operator next actions for launch blockers")
    expect(source).toContain("operationNextActionsMarkdown")
    expect(source).toContain("blockedBy")
    expect(source).toContain("Blocked by:")
    expect(source).toContain("launchDecision")
    expect(source).toContain("canStartDaemon")
    expect(source).toContain("ready-to-launch")
    expect(source).toContain("Launch Decision")
    expect(source).toContain("--require-launch-ready")
    expect(source).toContain("operator script can require launch-ready state before the daemon starts")
    expect(source).toContain("submit-credential-vault")
    expect(source).toContain("repair-selected-operation-plan")
    expect(source).toContain("--force --strict --json")
    expect(source).toContain("open the local ULMCode vault route")
    expect(source).toContain("/ulm/credentials?operationID=")
    expect(source).toContain("Genesis, Google, and Clever credential services are expected")
    expect(source).toContain("--duration-hours 72")
    expect(source).toContain("run-laptop-preflight")
    expect(source).toContain("run-literal-target-hours")
    expect(source).toContain("writes an explicit objective requirement matrix beside check-level evidence")
    expect(source).toContain("Objective Completion Matrix")
    expect(source).toContain("nextActionIds")
    expect(source).toContain("school-surface-private-wifi-launch")
    expect(source).toContain("professional-role-dossiers")
    expect(source).toContain("massive-modern-final-report-package")
    expect(source).toContain("selected-real-run-proof")
  })

  test("requires the profile handoff README to document the launch readiness gate", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")
    const blockStart = source.indexOf('requireText("tools/ulmcode-profile/README.md", profileReadme, [')
    const blockEnd = source.indexOf("  ])", blockStart)
    const profileReadmePins = source.slice(blockStart, blockEnd)

    expect(blockStart).toBeGreaterThanOrEqual(0)
    expect(profileReadmePins).toContain("launchReadiness")
    expect(profileReadmePins).toContain("--require-launch-ready")
  })

  test("requires rebuild audit coverage for current scope checks in selected launch packets", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("missingScopeRequirementRules")
    expect(source).toContain("target_hours_matches")
    expect(source).toContain("accepts selected launch packet commands that match a longer plan time budget")
    expect(source).toContain("does not accept selected launch packet daemon commands that undershoot the plan time budget")
    expect(source).toContain("unexpected_required_items")
    expect(source).toContain("does not accept selected launch packet checklist rows that are duplicated or unknown")
    expect(source).toContain("does not accept a selected launch packet whose scope requirements are stale")
    expect(source).toContain("does not accept selected launch packet scope requirements that are stale, noncanonical, or duplicated")
  })

  test("requires rebuild audit coverage for current credential checklist checks in selected launch packets", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("credential_checklist_services_current")
    expect(source).toContain("does not accept a selected launch packet whose structured credential requirements name stale services")
    expect(source).toContain("does not accept selected launch packet credential requirements that are noncanonical or duplicated")
    expect(source).toContain("does not accept a selected launch packet whose credential checklist names stale services")
    expect(source).toContain("accepts selected launch packet credential checklist services when SIS or vendor are explicit targets")
  })

  test("requires rebuild audit coverage for baseline scope rules in selected school laptop plans", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("missing_scope_baselines")
    expect(source).toContain("does not accept a selected school laptop plan without baseline scope rules")
  })

  test("requires rebuild audit coverage for canonical selected school laptop credential targets", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("credential_target_gaps")
    expect(source).toContain("does not accept selected school laptop plan credential targets that are noncanonical or duplicated")
  })

  test("requires rebuild audit coverage for canonical selected school laptop scope rules", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("scope_rule_gaps")
    expect(source).toContain("does not accept selected school laptop scope rules that are blank, padded, or duplicated")
  })

  test("requires rebuild audit coverage for role-focused identity boundaries in selected school laptop plans", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("identity-boundary")
    expect(source).toContain("does not accept a selected school laptop plan without role-focused identity research boundaries")
  })

  test("requires rebuild audit coverage for selected person and identity graph lanes", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("operation-graph-identity-lanes")
    expect(source).toContain("does not accept selected school laptop preflight without person and identity graph lanes")
  })

  test("requires rebuild audit coverage for stale selected preflight plan timestamps", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("preflight_stale_plan")
    expect(source).toContain("does not accept a selected laptop preflight older than the current operation plan")
  })

  test("requires rebuild audit coverage for selected preflight plan fingerprints", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("preflight_plan_fingerprint_current")
    expect(source).toContain("does not accept a selected laptop preflight whose plan fingerprint is stale")
  })

  test("requires rebuild audit coverage for laptop preflight plan freshness checks", async () => {
    const source = await fs.readFile(path.join(packageRoot, "script/ulm-rebuild-audit.ts"), "utf8")

    expect(source).toContain("plan-freshness")
    expect(source).toContain("blocks when the laptop clock would write preflight proof older than the plan")
  })

  test("allows explicitly blocked upstream research commits without failing readiness", async () => {
    const root = await makeUpstreamFixture("research: delete Hono backend (do not merge)")

    const proc = Bun.spawn(
      ["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--repo-root", root, "--check", "upstream_current"],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("blocked upstream commit deferred")
  })

  test("defers an upstream range rooted on a blocked research commit", async () => {
    const root = await makeUpstreamFixture("research: delete Hono backend (do not merge)")
    await addUpstreamCommit(root, "fix(server): later upstream fix", "LATER.md")

    const proc = Bun.spawn(
      ["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--repo-root", root, "--check", "upstream_current"],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("upstream range deferred")
    expect(stdout).toContain("2 missing commits")
  })

  test("still fails upstream audit for ordinary missing upstream commits", async () => {
    const root = await makeUpstreamFixture("fix(server): ordinary upstream fix")

    const proc = Bun.spawn(
      ["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--repo-root", root, "--check", "upstream_current"],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("branch is behind upstream/dev by 1 commits")
  })

  test("fails profile runtime audit when the tool manifest has no supervised command profiles", async () => {
    const root = await makeAuditFixture()
    await writeToolManifest(root, [])

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--silent",
        "script/ulm-rebuild-audit.ts",
        "--repo-root",
        root,
        "--check",
        "profile_runtime",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("expected at least four supervised command profiles")
  })

  test("fails harness scheduler audit when scheduled overnight artifacts are missing", async () => {
    const root = await makeAuditFixture()
    await writeToolManifest(root, [
      {
        id: "service-inventory",
        tool: "nmap",
        safety: "non_destructive",
        template: "nmap -sV -oA {outputPrefix} {target}",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/nmap.xml"],
      },
      {
        id: "http-discovery",
        tool: "httpx",
        safety: "non_destructive",
        template: "httpx -l {inputFile} -json -o {outputPrefix}.jsonl",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/httpx.jsonl"],
      },
      {
        id: "content-discovery",
        tool: "ffuf",
        safety: "non_destructive",
        template: "ffuf -u {url}/FUZZ -w {wordlist} -o {outputPrefix}.json",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/ffuf.json"],
      },
      {
        id: "passive-web-baseline",
        tool: "zap-baseline",
        safety: "non_destructive",
        template: "zap-baseline.py -t {url} -J {outputPrefix}.json",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: false,
        artifacts: ["evidence/raw/zap.json"],
      },
    ])
    await writeFixtureFile(root, ".github/workflows/ulm-harness.yml", "name: ulm-harness\non:\n  pull_request:\n")

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--silent",
        "script/ulm-rebuild-audit.ts",
        "--repo-root",
        root,
        "--check",
        "harness_scheduler",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain(".github/workflows/ulm-harness.yml: missing schedule:")
  })
})
