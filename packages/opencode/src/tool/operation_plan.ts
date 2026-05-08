import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_plan.txt"
import { Instance } from "@/project/instance"
import { writeOperationDiscoveryCharter, writeOperationPlan } from "@/ulm/artifact"
import { errorMessage } from "@/util/error"

const Phase = Schema.Struct({
  stage: Schema.Literals(["intake", "recon", "mapping", "validation", "reporting", "handoff"]),
  objective: Schema.String,
  actions: Schema.mutable(Schema.Array(Schema.String)),
  successCriteria: Schema.mutable(Schema.Array(Schema.String)),
  subagents: Schema.mutable(Schema.Array(Schema.String)),
  noSubagents: Schema.mutable(Schema.Array(Schema.String)),
})

const PlanningApproval = Schema.Struct({
  status: Schema.Literals(["not_required", "pending", "approved", "rejected"]),
  discoveryCharterPath: Schema.optional(Schema.String),
  approvedAt: Schema.optional(Schema.String),
  approver: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

const DiscoveryCharter = Schema.Struct({
  purpose: Schema.String,
  researchQuestions: Schema.mutable(Schema.Array(Schema.String)),
  reconInvestments: Schema.mutable(Schema.Array(Schema.String)),
  operatorQuestions: Schema.mutable(Schema.Array(Schema.String)),
  candidateDeepWorkLanes: Schema.mutable(Schema.Array(Schema.String)),
  decisionCriteriaForFullPlan: Schema.mutable(Schema.Array(Schema.String)),
})

const TimeBudget = Schema.Struct({
  targetHours: Schema.Number,
  finalizationWindowHours: Schema.optional(Schema.Number),
  durationFit: Schema.optional(
    Schema.Struct({
      confidence: Schema.Literals(["low", "medium", "high", "duration_sized"]),
      evidence: Schema.mutable(Schema.Array(Schema.String)),
      overflowBacklog: Schema.mutable(Schema.Array(Schema.String)),
    }),
  ),
  allocations: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        stage: Schema.Literals(["intake", "recon", "mapping", "validation", "reporting", "handoff"]),
        hours: Schema.Number,
        work: Schema.String,
      }),
    ),
  ),
})

const CoverageContract = Schema.Struct({
  status: Schema.optional(Schema.Literals(["unmet", "partial", "met", "released"])),
  goals: Schema.mutable(Schema.Array(Schema.String)),
  minimumEvidence: Schema.mutable(Schema.Array(Schema.String)),
  requiredLanes: Schema.mutable(Schema.Array(Schema.String)),
  allowedSkippedLanes: Schema.mutable(Schema.Array(Schema.String)),
  fallbackRules: Schema.mutable(Schema.Array(Schema.String)),
  retryRules: Schema.mutable(Schema.Array(Schema.String)),
  subagentOpportunities: Schema.mutable(Schema.Array(Schema.String)),
  reportGates: Schema.mutable(Schema.Array(Schema.String)),
  releaseNotes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  planningMode: Schema.optional(Schema.Literals(["compact", "discovery-charter", "full-duration"])),
  templateName: Schema.optional(Schema.String),
  trustLevel: Schema.optional(Schema.Literals(["guided", "moderate", "unattended", "lab_full"])),
  scanProfile: Schema.optional(Schema.Literals(["paranoid", "stealth", "balanced", "aggressive", "lab-insane"])),
  browserEvidence: Schema.optional(Schema.Boolean),
  operationMemory: Schema.optional(Schema.Boolean),
  reportDesignProfile: Schema.optional(Schema.Literals(["standard", "premium", "board-ready"])),
  assumptions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  planningApproval: Schema.optional(PlanningApproval),
  discoveryCharter: Schema.optional(DiscoveryCharter),
  timeBudget: Schema.optional(TimeBudget),
  coverageContract: Schema.optional(CoverageContract),
  phases: Schema.optional(Schema.mutable(Schema.Array(Phase))),
  reportingCloseout: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  phases: number
  planningMode: "discovery-charter" | "full-duration" | "compact"
  planningApprovalStatus?: "not_required" | "pending" | "approved" | "rejected"
  operatorView: string
}

function toolPromise<T>(try_: () => Promise<T>) {
  return Effect.tryPromise({
    try: try_,
    catch: (error) => new Error(errorMessage(error)),
  })
}

export const OperationPlanTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_plan",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const discoveryMode = params.planningMode === "discovery-charter" || (params.phases === undefined && params.discoveryCharter)
        const result =
          discoveryMode
            ? yield* toolPromise(() =>
                writeOperationDiscoveryCharter(Instance.worktree, {
                  operationID: params.operationID,
                  templateName: params.templateName,
                  trustLevel: params.trustLevel,
                  scanProfile: params.scanProfile,
                  browserEvidence: params.browserEvidence,
                  operationMemory: params.operationMemory,
                  reportDesignProfile: params.reportDesignProfile,
                  assumptions: params.assumptions,
                  planningApproval: params.planningApproval,
                  discoveryCharter: params.discoveryCharter ?? {
                    purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
                    researchQuestions: [],
                    reconInvestments: [],
                    operatorQuestions: [],
                    candidateDeepWorkLanes: [],
                    decisionCriteriaForFullPlan: [],
                  },
                }),
              ).pipe(Effect.orDie)
            : yield* toolPromise(() =>
                writeOperationPlan(Instance.worktree, {
                  ...params,
                  phases: params.phases ?? [],
                  reportingCloseout: params.reportingCloseout ?? [],
                }),
              ).pipe(Effect.orDie)
        const approvalStatus = discoveryMode ? (params.planningApproval?.status ?? "pending") : params.planningApproval?.status
        const operatorView = "Review the plan preview below or open the markdown artifact path."
        const preview = yield* Effect.tryPromise(() => Bun.file(result.markdown).text()).pipe(
          Effect.catch(() => Effect.succeed("")),
        )
        const previewText = preview.split("\n").slice(0, 28).join("\n").trim()
        const nextStep = discoveryMode
          ? approvalStatus === "approved"
            ? "bounded_discovery_then_full_duration_plan"
            : approvalStatus === "rejected"
              ? "revise_charter_before_discovery"
              : "ask_operator_to_approve_discovery_charter"
          : "execute_plan_and_keep_status_updated"
        return {
          title: result.phases === 0 ? `Wrote Discovery Charter for ${result.operationID}` : `Wrote operation plan for ${result.operationID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `plan_kind: ${discoveryMode ? "discovery_charter" : "operation_plan"}`,
            `planning_mode: ${params.planningMode ?? (discoveryMode ? "discovery-charter" : "compact")}`,
            ...(approvalStatus ? [`planning_approval: ${approvalStatus}`] : []),
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `phases: ${result.phases}`,
            `operator_view: ${operatorView}`,
            `next_step: ${nextStep}`,
            ...(previewText ? ["", "plan_preview:", "```markdown", previewText, "```"] : []),
          ].join("\n"),
          metadata: {
            ...result,
            planningMode: params.planningMode ?? (discoveryMode ? "discovery-charter" : "compact"),
            planningApprovalStatus: approvalStatus,
            operatorView,
          },
        }
      }),
  }),
)
