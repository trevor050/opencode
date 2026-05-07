import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_plan.txt"
import { Instance } from "@/project/instance"
import { writeOperationPlan } from "@/ulm/artifact"

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
  phases: Schema.mutable(Schema.Array(Phase)),
  reportingCloseout: Schema.mutable(Schema.Array(Schema.String)),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  phases: number
}

export const OperationPlanTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_plan",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeOperationPlan(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Wrote operation plan for ${result.operationID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `phases: ${result.phases}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
