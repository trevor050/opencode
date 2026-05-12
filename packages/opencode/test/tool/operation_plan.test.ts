import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Layer } from "effect"
import fs from "fs/promises"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID, SessionID } from "@/session/schema"
import { OperationPlanTool } from "@/tool/operation_plan"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

function executionBlocks(input: { minutes: number; laneID?: string; stage?: "recon" | "validation" | "reporting" | "handoff" }) {
  const laneID = input.laneID ?? "recon"
  const stage = input.stage ?? "recon"
  const blockMinutes = input.minutes >= 480 ? 60 : 30
  const count = Math.ceil(input.minutes / blockMinutes)
  return Array.from({ length: count }, (_, index) => ({
    id: `block-${index + 1}`,
    stage,
    laneID,
    title: `Bounded ${stage} work block ${index + 1}`,
    startMinute: index * blockMinutes,
    durationMinutes: blockMinutes,
    objective: `Complete bounded ${stage} work block ${index + 1}.`,
    actions: [`Run the scoped ${stage} action for block ${index + 1}.`],
    successCriteria: [`Block ${index + 1} records evidence, blockers, or a safe fallback.`],
    fallbackWork: [`If the primary action stalls, run the narrower safe fallback for block ${index + 1}.`],
    subagents: stage === "reporting" ? ["report-writer"] : [laneID],
    expectedArtifacts: [`work-blocks/block-${index + 1}.md`],
  }))
}

describe("tool.operation_plan", () => {
  test("rejects durable plan rewrites after execution has started", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const operationRoot = `${dir.path}/.ulmcode/operations/school`
            yield* Effect.promise(() => fs.mkdir(`${operationRoot}/lane-complete`, { recursive: true }))
            yield* Effect.promise(() => fs.writeFile(`${operationRoot}/lane-complete/recon.json`, "{}\n"))
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const exit = yield* def
              .execute(
                {
                  operationID: "school",
                  phases: [
                    {
                      stage: "recon",
                      objective: "Rewrite after execution started.",
                      actions: ["Do not allow this."],
                      successCriteria: ["Plan is rejected."],
                      subagents: [],
                      noSubagents: [],
                    },
                  ],
                  reportingCloseout: ["operation_audit finalHandoff=true"],
                },
                {
                  sessionID: SessionID.make("session-1"),
                  messageID: MessageID.ascending(),
                  agent: "build",
                  abort: new AbortController().signal,
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                },
              )
              .pipe(Effect.exit)

            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return
            const message = Cause.pretty(exit.cause)
            expect(message).toContain("operation_plan cannot rewrite the durable plan after operation execution has started")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("accepts Discovery Charter calls before final plan fields exist", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "home-network-hardrun-20260507",
                planningMode: "discovery-charter",
                templateName: "home-network-discovery-charter",
                trustLevel: "unattended",
                scanProfile: "aggressive",
                browserEvidence: true,
                operationMemory: true,
                reportDesignProfile: "standard",
                discoveryCharter: {
                  purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
                  researchQuestions: ["What is in scope?", "Which auth surfaces exist?", "What evidence is needed?"],
                  reconInvestments: ["Passive inventory", "Login surface map", "Safe service classification"],
                  operatorQuestions: ["Are credentials available?", "Are disruptive checks excluded?"],
                  candidateDeepWorkLanes: ["Router review", "IoT inventory", "Authenticated portal validation"],
                  decisionCriteriaForFullPlan: ["Safe lanes exist", "Credentials are known", "Report closeout is budgeted"],
                },
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            expect(result.title).toContain("Discovery Charter")
            expect(result.output).toContain("discovery-charter.md")
            expect(result.output).toContain("plan_kind: discovery_charter")
            expect(result.output).toContain("planning_approval: pending")
            expect(result.output).toContain("operator_view:")
            expect(result.output).toContain("plan_preview:")
            expect(result.output).not.toContain("/all")
            expect(result.metadata.phases).toBe(0)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("persists explicitly approved Discovery Charter approval state", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "home-network-hardrun-20260507",
                planningMode: "discovery-charter",
                planningApproval: {
                  status: "approved",
                  discoveryCharterPath: "plans/discovery-charter.md",
                  approver: "operator",
                  notes: ["Operator explicitly approved the Discovery Charter."],
                },
                discoveryCharter: {
                  purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
                  researchQuestions: ["What is in scope?", "Which auth surfaces exist?", "What evidence is needed?"],
                  reconInvestments: ["Passive inventory", "Login surface map", "Safe service classification"],
                  operatorQuestions: ["Are credentials available?", "Are disruptive checks excluded?"],
                  candidateDeepWorkLanes: ["Router review", "IoT inventory", "Authenticated portal validation"],
                  decisionCriteriaForFullPlan: ["Safe lanes exist", "Credentials are known", "Report closeout is budgeted"],
                },
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            const markdown = yield* Effect.promise(() => fs.readFile(result.metadata.markdown, "utf8"))

            expect(record.planningApproval.status).toBe("approved")
            expect(record.planningApproval.approver).toBe("operator")
            expect(markdown).toContain("Discovery Charter approved")
            expect(result.output).toContain("planning_approval: approved")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("rejects coverage contracts with lane ids that operation_schedule cannot create", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const exit = yield* def
              .execute(
                {
                  operationID: "synthetic-privileged-access-drill",
                  planningMode: "compact",
                  reportingCloseout: ["report_lint", "report_render", "runtime_summary"],
                  coverageContract: {
                    status: "partial",
                    goals: ["Complete a synthetic privileged access report drill."],
                    minimumEvidence: ["Synthetic evidence recorded."],
                    requiredLanes: ["attack-chain", "report-lint-render-runtime-audit"],
                    allowedSkippedLanes: [],
                    fallbackRules: ["Name blockers instead of weakening the claim."],
                    retryRules: ["Retry report_render once after lint cleanup."],
                    subagentOpportunities: ["No subagents for compact drill."],
                    reportGates: ["report_lint", "report_render", "operation_audit"],
                  },
                  phases: [
                    {
                      stage: "reporting",
                      objective: "Create final report deliverables.",
                      actions: ["Render report package."],
                      successCriteria: ["Report artifacts exist."],
                      subagents: [],
                      noSubagents: ["Compact synthetic drill stays local."],
                    },
                  ],
                },
                {
                  sessionID: SessionID.make("session-1"),
                  messageID: MessageID.ascending(),
                  agent: "build",
                  abort: new AbortController().signal,
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                },
              )
              .pipe(Effect.exit)

            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return
            const message = String(Cause.squash(exit.cause))
            expect(message).toContain("coverageContract.requiredLanes must use operation_schedule lane ids")
            expect(message).toContain("attack-chain")
            expect(message).toContain("report_writing")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("accepts full-duration plans whose approved charter purpose describes discovery work", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "home-network-harness-20260507",
                planningMode: "full-duration",
                templateName: "home-network-harness-full-duration",
                trustLevel: "unattended",
                scanProfile: "aggressive",
                browserEvidence: true,
                operationMemory: true,
                reportDesignProfile: "standard",
                assumptions: [
                  "Authorized home-network harness; aggressive non-destructive testing only.",
                  "No installs, no credential attacks, no config writes, and report/handoff window is reserved.",
                ],
                planningApproval: {
                  status: "approved",
                  discoveryCharterPath: ".ulmcode/operations/home-network-harness-20260507/plans/discovery-charter.md",
                  approver: "operator",
                  notes: ["Discovery Charter approval is durable."],
                },
                discoveryCharter: {
                  purpose: "Use bounded discovery and target classification to support a safe, duration-sized autonomous home-network harness test.",
                  researchQuestions: [
                    "Which live hosts and services exist across approved LAN/WAN/IPv6/VPN scope?",
                    "Which gateway/admin, web/TLS, SSH, DNS, SMB, UPnP, or mDNS surfaces deserve safe validation?",
                    "Can approved authenticated checks be performed read-only without secret leakage?",
                  ],
                  reconInvestments: [
                    "Preserve local/passive baseline.",
                    "Run supervised LAN discovery and service inventory.",
                    "Run HTTP/TLS discovery and browser review where relevant.",
                  ],
                  operatorQuestions: [
                    "No routine follow-up after kickoff; use conservative defaults.",
                    "Block disruptive ideas and report required change-control details.",
                  ],
                  candidateDeepWorkLanes: [
                    "LAN discovery/service inventory",
                    "Gateway/router review",
                    "Windows SSH read-only review",
                  ],
                  decisionCriteriaForFullPlan: [
                    "Tool inventory is sufficient.",
                    "Baseline identifies gateway/local/WAN/IPv6/VPN/candidate neighbors.",
                    "Credential boundaries are clear.",
                  ],
                },
                timeBudget: {
                  targetHours: 3.3,
                  finalizationWindowHours: 0.7,
                  durationFit: {
                    confidence: "duration_sized",
                    evidence: ["Tool inventory and baseline evidence show enough safe scoped work."],
                    overflowBacklog: ["Narrow retry scans and deeper gateway review if discovery is sparse."],
                  },
                  allocations: [
                    { stage: "recon", hours: 0.75, work: "LAN/WAN/IPv6/VPN discovery and service inventory." },
                    { stage: "validation", hours: 0.75, work: "Non-destructive validation plus read-only authenticated checks." },
                    { stage: "reporting", hours: 0.75, work: "Evidence normalization, report draft, lint, and render." },
                    { stage: "handoff", hours: 0.45, work: "Runtime summary, audit, and final handoff." },
                  ],
                  executionBlocks: executionBlocks({ minutes: 156 }),
                },
                coverageContract: {
                  status: "unmet",
                  goals: ["Discover authorized hosts/services.", "Validate or reject all candidate findings."],
                  minimumEvidence: ["Tool inventory.", "Local passive baseline.", "Service discovery outputs or blockers."],
                  requiredLanes: ["network_discovery", "service_inventory", "finding_validation", "report_review"],
                  allowedSkippedLanes: ["Gateway auth if mapping/login fails."],
                  fallbackRules: ["Use installed fallbacks only.", "Narrow slow scans instead of waiting foreground."],
                  retryRules: ["Retry timeouts once with narrower scope."],
                  subagentOpportunities: ["recon", "validator", "report-reviewer"],
                  reportGates: ["operation_stage_gate validation", "report_lint", "report_render"],
                  releaseNotes: ["Coverage releases only after supervisor/report/audit gates pass."],
                },
                phases: [
                  {
                    stage: "intake",
                    objective: "Start from the approved plan safely.",
                    actions: ["Schedule graph", "Run startup supervisor", "Launch only non-destructive lanes"],
                    successCriteria: ["Graph exists and supervisor does not block."],
                    subagents: [],
                    noSubagents: ["Credential handling stays in the primary session."],
                  },
                  {
                    stage: "recon",
                    objective: "Discover hosts and services safely.",
                    actions: ["Run supervised LAN discovery", "Run service inventory", "Run HTTP/TLS discovery"],
                    successCriteria: ["Evidence or blockers are recorded."],
                    subagents: ["recon"],
                    noSubagents: ["No exploit agents."],
                  },
                  {
                    stage: "validation",
                    objective: "Validate or reject candidates.",
                    actions: ["Perform read-only gateway review", "Perform read-only SSH review", "Record findings"],
                    successCriteria: ["All candidates are validated or rejected."],
                    subagents: ["validator"],
                    noSubagents: ["No destructive exploitation."],
                  },
                  {
                    stage: "reporting",
                    objective: "Produce evidence-linked report.",
                    actions: ["Normalize evidence", "Draft report", "Review, lint, and render"],
                    successCriteria: ["Report gates pass or blockers are recorded."],
                    subagents: ["evidence", "report-writer", "report-reviewer"],
                    noSubagents: [],
                  },
                ],
                reportingCloseout: [
                  "operation_stage_gate validation",
                  "report_outline audience=mixed targetPages=8",
                  "report_lint",
                  "report_render",
                  "runtime_summary",
                  "operation_audit",
                ],
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))

            expect(result.output).toContain("plan_kind: operation_plan")
            expect(result.output).toContain("planning_approval: approved")
            expect(result.metadata.phases).toBe(4)
            expect(record.timeBudget.durationFit.confidence).toBe("duration_sized")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("accepts approved K-12 full-duration plans with summarized charter evidence", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "daring-wild-ef9bb6",
                planningMode: "full-duration",
                templateName: "standard-k12-gentle-balanced-full-plan",
                trustLevel: "unattended",
                scanProfile: "stealth",
                browserEvidence: false,
                operationMemory: true,
                reportDesignProfile: "standard",
                assumptions: [
                  "planningMode: full-duration; durationBand: standard (4.5 hours); operator approved Discovery Charter as written before this plan.",
                  "No credentials, no auth attacks, no exploitation, AP testing exclusion, and technical+executive handoff.",
                ],
                planningApproval: {
                  status: "approved",
                  discoveryCharterPath: ".ulmcode/operations/daring-wild-ef9bb6/plans/discovery-charter.md",
                  approver: "operator",
                  notes: [
                    "Discovery Charter approved at 2026-05-08T15:08:00Z.",
                    "Awaiting operator approval of this full duration-sized operation plan before operation_schedule and broad execution.",
                  ],
                },
                discoveryCharter: {
                  purpose:
                    "Approved charter established enough evidence to size a safe 4.5-hour non-disruptive Middlesex K12 operation without touching AP testing or fragile/student systems.",
                  researchQuestions: [
                    "Canonical domains and web surfaces are sufficient for safe web/DNS/email work.",
                    "Email/DNS posture can be safely validated from DNS records without credentials.",
                    "Public SaaS mapping can be safely developed from DNS TXT and public pages.",
                    "Professional org/person context is useful for remediation routing and can exclude private information.",
                    "Internal sample feasibility is high-caution and optional unless clear server-only targets emerge.",
                  ],
                  reconInvestments: [
                    "Completed initial public search, DNS, header-only HTTP, httpx metadata, internal DNS-only feasibility, district profile, asset graph, identity graph, and candidate DKIM lead.",
                    "Full plan will invest mostly in public/SaaS/email validation and reporting, with internal safe-sample only if no AP/student/WiFi/fragile risk exists.",
                  ],
                  operatorQuestions: [
                    "No additional routine questions planned after full-plan approval.",
                    "If ambiguity arises during execution, skip the ambiguous action and record the limitation.",
                  ],
                  candidateDeepWorkLanes: [
                    "Email/DNS posture validation and DKIM candidate validation.",
                    "Public web/CMS posture through metadata only.",
                    "Public SaaS exposure and workflow mapping.",
                    "Professional technology/org role profile and identity graph refinement.",
                    "Narrow internal DNS/passive/server-only feasibility lane with skip-by-default controls.",
                    "Evidence normalization, validation, report writing, review, render, runtime summary, eval scorecard, audit, and handoff.",
                  ],
                  decisionCriteriaForFullPlan: [
                    "Met: multiple public-domain/system leads are evidence-backed.",
                    "Met: email/DNS posture is safely testable without credentials.",
                    "Met with limitation: web surfaces are safely checkable via metadata but content fetches are Cloudflare challenged.",
                    "Met with constraint: internal sample should be DNS/passive or skipped unless server-only targets are clear.",
                    "Met: enough safe public/SaaS/reporting/fallback work exists for 4.5 hours.",
                  ],
                },
                timeBudget: {
                  targetHours: 4.5,
                  finalizationWindowHours: 1.2,
                  durationFit: {
                    confidence: "duration_sized",
                    evidence: ["Discovery evidence confirms multiple independent safe lanes."],
                    overflowBacklog: ["If internal sample is unsafe, spend additional time on public/SaaS/reporting work."],
                  },
                  allocations: [
                    { stage: "intake", hours: 0.55, work: "Completed kickoff rounds, charter approval, and full plan approval gate." },
                    { stage: "recon", hours: 1.05, work: "Public domain/DNS/email expansion, web/CMS metadata, SaaS mapping, and internal feasibility." },
                    { stage: "mapping", hours: 0.45, work: "Update district profile, asset graph, identity graph, and candidate validation queue." },
                    { stage: "validation", hours: 0.85, work: "Validate or reject candidate email/web/SaaS/internal-feasibility issues." },
                    { stage: "reporting", hours: 1.25, work: "Evidence normalization, report outline, report drafting, report review, lint, and render." },
                    { stage: "handoff", hours: 0.35, work: "Runtime summary, eval scorecard, operation audit, handoff gate, and final handoff." },
                  ],
                  executionBlocks: executionBlocks({ minutes: 198 }),
                },
                coverageContract: {
                  status: "unmet",
                  goals: ["Safely assess Middlesex K12 public web/CMS, email/domain security, SaaS exposure, org context, and bounded internal feasibility."],
                  minimumEvidence: ["Public domain inventory and canonical-domain evidence."],
                  requiredLanes: ["district_profile", "recon", "web_inventory", "saas_cloud_review", "finding_validation", "report_review"],
                  allowedSkippedLanes: ["Internal active service sampling may be skipped if no clearly server-only targets can be identified safely."],
                  fallbackRules: ["Skip ambiguous targets and document coverage impact."],
                  retryRules: ["Low-impact DNS/HTTP metadata retries only with short timeouts and low counts."],
                  subagentOpportunities: ["recon lane for public DNS/web/SaaS mapping and internal feasibility notes."],
                  reportGates: ["operation_stage_gate(validation) after validation queue is resolved."],
                  releaseNotes: ["Coverage is not released until required lanes complete or are explicitly skipped with low/accepted impact."],
                },
                phases: [
                  {
                    stage: "intake",
                    objective: "Lock full-plan approval and launch schedule safely.",
                    actions: ["Get operator approval for this full plan."],
                    successCriteria: ["Full plan approval is durable."],
                    subagents: [],
                    noSubagents: ["No broad execution before approval/schedule."],
                  },
                  {
                    stage: "recon",
                    objective: "Complete safe recon without touching AP testing or fragile/student systems.",
                    actions: ["Run public DNS/email posture checks."],
                    successCriteria: ["Recon evidence covers domain/email/web/SaaS/org lanes."],
                    subagents: ["recon"],
                    noSubagents: ["No vulnerability scanner across broad internal subnets."],
                  },
                  {
                    stage: "mapping",
                    objective: "Transform recon into durable asset, identity, and validation maps.",
                    actions: ["Update district_profile."],
                    successCriteria: ["Maps cite evidence."],
                    subagents: ["attack-map"],
                    noSubagents: ["No private-life person research; no account enumeration."],
                  },
                  {
                    stage: "validation",
                    objective: "Validate or reject safe candidate findings without exploitation.",
                    actions: ["Validate candidate DKIM 1024-bit selector."],
                    successCriteria: ["All candidates are validated, rejected, or explicitly deferred with evidence."],
                    subagents: ["validator"],
                    noSubagents: ["No exploitation or authenticated portal testing."],
                  },
                  {
                    stage: "reporting",
                    objective: "Produce a dense technical+executive deliverable from evidence.",
                    actions: ["Normalize evidence."],
                    successCriteria: ["Report is evidence-backed and not sparse."],
                    subagents: ["evidence", "report-writer", "report-reviewer"],
                    noSubagents: ["No unsupported risk claims."],
                  },
                  {
                    stage: "handoff",
                    objective: "Complete durable handoff gates and summarize results.",
                    actions: ["Run runtime_summary."],
                    successCriteria: ["Runtime summary, render manifest, eval scorecard, audit, and handoff gate exist."],
                    subagents: ["report-reviewer"],
                    noSubagents: ["No chat-only final handoff."],
                  },
                ],
                reportingCloseout: [
                  "operation_stage_gate(validation) after validation queue is resolved.",
                  "report_outline(audience=mixed,targetPages=8,includeAppendix=true,includeCoverageSection=true,includeHandoffChecklist=true).",
                  "report_lint require report, operation plan, rendered deliverables after render, runtime summary, outline sections, and finding sections.",
                  "report_render writes HTML/PDF/README/manifest.",
                  "runtime_summary records budget, background tasks, compaction, and canonical artifacts.",
                ],
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            expect(result.output).toContain("plan_kind: operation_plan")
            expect(result.metadata.phases).toBe(6)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("reports full-duration validation errors without leaking Effect.tryPromise", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const exit = yield* def
              .execute(
                {
                  operationID: "school",
                  planningMode: "full-duration",
                  planningApproval: {
                    status: "pending",
                    discoveryCharterPath: "plans/discovery-charter.md",
                  },
                  discoveryCharter: {
                    purpose: "Approved charter summary.",
                    researchQuestions: ["What public systems are in scope?"],
                    reconInvestments: ["Public DNS review."],
                    operatorQuestions: ["Use conservative defaults."],
                    candidateDeepWorkLanes: ["Email posture."],
                    decisionCriteriaForFullPlan: ["Duration-sized evidence exists."],
                  },
                  timeBudget: {
                    targetHours: 3,
                    finalizationWindowHours: 0.5,
                    durationFit: {
                      confidence: "duration_sized",
                      evidence: ["Safe scoped work exists."],
                      overflowBacklog: ["Use reporting work if discovery is sparse."],
                    },
                    allocations: [
                      { stage: "recon", hours: 1, work: "Public DNS review." },
                      { stage: "reporting", hours: 1, work: "Report closeout." },
                    ],
                  },
                  coverageContract: {
                    status: "unmet",
                    goals: ["Assess safe public posture."],
                    minimumEvidence: ["DNS evidence."],
                    requiredLanes: ["dns"],
                    allowedSkippedLanes: [],
                    fallbackRules: ["Skip ambiguous targets."],
                    retryRules: ["Retry DNS once."],
                    subagentOpportunities: ["recon"],
                    reportGates: ["report_lint"],
                  },
                  phases: [
                    {
                      stage: "recon",
                      objective: "Review safe public posture.",
                      actions: ["Run DNS checks."],
                      successCriteria: ["DNS evidence exists."],
                      subagents: ["recon"],
                      noSubagents: [],
                    },
                  ],
                  reportingCloseout: ["report_lint", "report_render", "runtime_summary"],
                },
                {
                  sessionID: SessionID.make("session-1"),
                  messageID: MessageID.ascending(),
                  agent: "build",
                  abort: new AbortController().signal,
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                },
              )
              .pipe(Effect.exit)

            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return
            const message = String(Cause.squash(exit.cause))
            expect(message).toContain("2h+ operation plan requires planningApproval.status=approved")
            expect(message).not.toContain("Effect.tryPromise")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
