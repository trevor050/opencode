import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { buildCommandPlan, writeCommandPlan } from "@/ulm/tool-manifest"
import { tmpdir } from "../fixture/fixture"

describe("ULM tool manifest command plans", () => {
  test("renders and persists a supervised non-destructive command profile", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "nmap",
            purpose: "service inventory",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sV <target>"],
            outputParsers: ["xml"],
            fallbacks: ["httpx"],
          },
        ],
        commandProfiles: [
          {
            id: "service-inventory",
            tool: "nmap",
            safety: "non_destructive",
            template: "nmap -sV -oA {outputPrefix} {target}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/nmap.xml"],
          },
        ],
      }),
    )

    const plan = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "service-inventory",
      variables: { target: "10.0.0.10" },
      outputPrefix: "evidence/raw/school-services",
      manifestPath,
    })
    await writeCommandPlan(plan)

    expect(plan.command).toBe("nmap -sV -oA evidence/raw/school-services 10.0.0.10")
    expect(plan.supervision.hardTimeoutSeconds).toBe(1200)
    expect(plan.artifacts).toContain("evidence/raw/school-services.xml")
    expect(plan.artifacts).toContain("evidence/raw/school-services.nmap")
    const persisted = JSON.parse(await fs.readFile(plan.planPath, "utf8")) as {
      command?: string
      supervision?: unknown
      variables?: Record<string, string>
      outputPrefix?: string
      manifestPath?: string
    }
    expect(persisted.command).toBe(plan.command)
    expect(persisted.supervision).toEqual(plan.supervision)
    expect(persisted.variables?.target).toBe("10.0.0.10")
    expect(persisted.outputPrefix).toBe("evidence/raw/school-services")
    expect(persisted.manifestPath).toBe(manifestPath)
    await expect(fs.stat(path.join(dir.path, ".ulmcode", "operations", "school", "evidence", "raw"))).resolves.toBeTruthy()
  })

  test("rejects destructive command profiles for unattended supervision", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "ffuf",
            purpose: "content brute force",
            safety: "interactive_destructive",
            install: [{ platform: "go", command: "go install github.com/ffuf/ffuf/v2@latest" }],
            validate: "ffuf -V",
            safeExamples: ["ffuf -u https://host/FUZZ -w words"],
            outputParsers: ["json"],
            fallbacks: ["manual"],
          },
        ],
        commandProfiles: [
          {
            id: "aggressive-fuzz",
            tool: "ffuf",
            safety: "interactive_destructive",
            template: "ffuf -u {url}/FUZZ -w {wordlist}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/ffuf.json"],
          },
        ],
      }),
    )

    await expect(
      buildCommandPlan({
        worktree: dir.path,
        operationID: "School",
        profileID: "aggressive-fuzz",
        variables: { url: "https://school.example", wordlist: "big.txt" },
        manifestPath,
      }),
    ).rejects.toThrow("unattended command_supervise only allows non_destructive")
  })

  test("rejects privileged command profiles for unattended supervision", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "nmap",
            purpose: "UDP service inventory",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sU <target>"],
            outputParsers: ["xml"],
            fallbacks: ["tcp-service-inventory"],
          },
        ],
        commandProfiles: [
          {
            id: "udp-top-ports-sweep",
            tool: "nmap",
            safety: "non_destructive",
            requiresPrivilege: true,
            privilegeReason: "UDP scans require raw-socket privileges.",
            template: "nmap -sU --top-ports 50 -oA {outputPrefix} {target}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/udp.xml"],
          },
        ],
      }),
    )

    await expect(
      buildCommandPlan({
        worktree: dir.path,
        operationID: "School",
        profileID: "udp-top-ports-sweep",
        variables: { target: "10.0.0.10" },
        manifestPath,
      }),
    ).rejects.toThrow("requires elevated privileges")
  })

  test("keeps repeated profile launches from clobbering command state", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "httpx",
            purpose: "http discovery",
            safety: "non_destructive",
            install: [{ platform: "go", command: "go install github.com/projectdiscovery/httpx/cmd/httpx@latest" }],
            validate: "httpx -version",
            safeExamples: ["httpx -l hosts.txt"],
            outputParsers: ["jsonl"],
            fallbacks: [],
          },
        ],
        commandProfiles: [
          {
            id: "http-discovery",
            tool: "httpx",
            safety: "non_destructive",
            template: "httpx -l {inputFile} -json -o {outputPrefix}.jsonl",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/httpx.jsonl"],
          },
        ],
      }),
    )

    const first = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "http-discovery",
      variables: { inputFile: "hosts-a.txt" },
      outputPrefix: "evidence/raw/http-a",
      manifestPath,
    })
    await writeCommandPlan(first)
    const second = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "http-discovery",
      variables: { inputFile: "hosts-b.txt" },
      outputPrefix: "evidence/raw/http-b",
      manifestPath,
    })
    await writeCommandPlan(second)

    expect(path.dirname(first.planPath)).not.toBe(path.dirname(second.planPath))
    expect(JSON.parse(await fs.readFile(first.planPath, "utf8")).outputPrefix).toBe("evidence/raw/http-a")
    expect(JSON.parse(await fs.readFile(second.planPath, "utf8")).outputPrefix).toBe("evidence/raw/http-b")
  })

  test("upgrades a dry-run command plan to the real launch directory", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "nmap",
            purpose: "host discovery",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sn <target>"],
            outputParsers: ["xml"],
            fallbacks: [],
          },
        ],
        commandProfiles: [
          {
            id: "icmp-sweep",
            tool: "nmap",
            safety: "non_destructive",
            template: "nmap -sn -oA {outputPrefix} {target}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/icmp-sweep.xml"],
          },
        ],
      }),
    )

    const planned = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "icmp-sweep",
      variables: { target: "10.0.0.0/24" },
      outputPrefix: "evidence/raw/icmp",
      manifestPath,
      dryRun: true,
    })
    await writeCommandPlan(planned)
    const launched = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "icmp-sweep",
      variables: { target: "10.0.0.0/24" },
      outputPrefix: "evidence/raw/icmp",
      manifestPath,
      dryRun: false,
    })

    expect(path.dirname(launched.planPath)).toBe(path.dirname(planned.planPath))
  })
})
