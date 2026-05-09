import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { EVIDENCE_KINDS, FINDING_STATES, OPERATION_STATUSES, RISK_LEVELS, SEVERITIES, STAGES } from "@/ulm/artifact"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/ulm/operation"

export const UlmPaths = {
  list: root,
  template: `${root}/template`,
  close: `${root}/close`,
  status: `${root}/:operationID/status`,
  resume: `${root}/:operationID/resume`,
  audit: `${root}/:operationID/audit`,
  recover: `${root}/:operationID/recover`,
  daemonStart: `${root}/:operationID/daemon/start`,
  daemonStop: `${root}/:operationID/daemon/stop`,
  daemonStatus: `${root}/:operationID/daemon/status`,
  finalArtifacts: `${root}/:operationID/final-artifacts`,
  finalArtifact: `${root}/:operationID/final-artifacts/:artifactID`,
  finalArtifactOpen: `${root}/:operationID/final-artifacts/:artifactID/open`,
  credentials: `${root}/:operationID/credentials`,
  credential: `${root}/:operationID/credentials/:credentialID`,
  materializeCredentials: `${root}/:operationID/credentials/materialize-env`,
} as const

const QueryBoolean = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)

export const UlmListQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
})

export const UlmOperationQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
})

export const UlmResumeQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
  staleAfterMinutes: Schema.optional(Schema.NumberFromString),
})

export const UlmAuditQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
  staleAfterMinutes: Schema.optional(Schema.NumberFromString),
  minWords: Schema.optional(Schema.NumberFromString),
  requireOutlineBudget: Schema.optional(QueryBoolean),
  minOutlineWordsPerPage: Schema.optional(Schema.NumberFromString),
  requireFindingSections: Schema.optional(QueryBoolean),
  minFindingWords: Schema.optional(Schema.NumberFromString),
  finalHandoff: Schema.optional(QueryBoolean),
})

const JsonObject = Schema.Record(Schema.String, Schema.Any)
export const UlmCloseOperationsPayload = Schema.Struct({
  operationIDs: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "UlmCloseOperationsPayload" })
const CloseOperationsResult = Schema.Struct({
  closed: Schema.Array(Schema.String),
  remaining: Schema.Finite,
}).annotate({ identifier: "UlmCloseOperationsResult" })
const UlmTemplateID = Schema.Literals([
  "single-url-web",
  "external-k12-district",
  "authenticated-webapp",
  "internal-network",
  "cloud-posture",
  "code-audit",
  "report-only",
  "benchmark-suite",
])
const UlmTrustLevel = Schema.Literals(["guided", "moderate", "unattended", "lab_full"])
const UlmScanProfile = Schema.Literals(["paranoid", "stealth", "balanced", "aggressive", "lab-insane"])
const EvidenceRef = Schema.Struct({
  id: Schema.String,
  path: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
}).annotate({ identifier: "UlmEvidenceRef" })
const OperationTime = Schema.Struct({
  created: Schema.String,
  updated: Schema.String,
}).annotate({ identifier: "UlmOperationTime" })
const OperationRecord = Schema.Struct({
  operationID: Schema.String,
  objective: Schema.String,
  stage: Schema.Literals(STAGES),
  status: Schema.Literals(OPERATION_STATUSES),
  summary: Schema.String,
  nextActions: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String),
  riskLevel: Schema.Literals(RISK_LEVELS),
  activeTasks: Schema.Array(Schema.String),
  evidence: Schema.Array(EvidenceRef),
  notes: Schema.optional(Schema.String),
  time: OperationTime,
}).annotate({ identifier: "UlmOperationRecord" })
const FindingCounts = Schema.Struct({
  total: Schema.Finite,
  byState: Schema.Record(Schema.Literals(FINDING_STATES), Schema.Finite),
  bySeverity: Schema.Record(Schema.Literals(SEVERITIES), Schema.Finite),
}).annotate({ identifier: "UlmFindingCounts" })
const EvidenceCounts = Schema.Struct({
  total: Schema.Finite,
  byKind: Schema.Record(Schema.Literals(EVIDENCE_KINDS), Schema.Finite),
}).annotate({ identifier: "UlmEvidenceCounts" })
const ReportArtifacts = Schema.Struct({
  outline: Schema.Boolean,
  markdown: Schema.Boolean,
  html: Schema.Boolean,
  pdf: Schema.Boolean,
  readme: Schema.Boolean,
  manifest: Schema.Boolean,
}).annotate({ identifier: "UlmReportArtifacts" })
const RuntimeSnapshot = JsonObject.annotate({ identifier: "UlmRuntimeSnapshot" })
const OperationGoalStatus = Schema.Struct({
  status: Schema.String,
  objective: Schema.String,
  targetDurationHours: Schema.optional(Schema.Finite),
  updatedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
}).annotate({ identifier: "UlmOperationGoalStatus" })
const SupervisorStatus = Schema.Struct({
  generatedAt: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  requiredNextTool: Schema.optional(Schema.String),
  blockers: Schema.Array(Schema.String),
  nextTools: Schema.Array(Schema.String),
}).annotate({ identifier: "UlmSupervisorStatus" })
const ToolInventoryStatus = Schema.Struct({
  generatedAt: Schema.optional(Schema.String),
  total: Schema.Finite,
  installed: Schema.Finite,
  missing: Schema.Finite,
  highValueMissing: Schema.Finite,
  installedHighValue: Schema.Array(Schema.String),
  missingHighValue: Schema.Array(Schema.String),
}).annotate({ identifier: "UlmToolInventoryStatus" })
const OperationStatusSummary = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  operation: Schema.optional(OperationRecord),
  goal: Schema.optional(OperationGoalStatus),
  supervisor: Schema.optional(SupervisorStatus),
  toolInventory: Schema.optional(ToolInventoryStatus),
  policies: Schema.Struct({
    foregroundCommand: Schema.String,
  }).annotate({ identifier: "UlmOperationPolicies" }),
  plans: Schema.Struct({ operation: Schema.Boolean }).annotate({ identifier: "UlmPlanArtifacts" }),
  findings: FindingCounts,
  evidence: EvidenceCounts,
  reports: ReportArtifacts,
  runtimeSummary: Schema.Boolean,
  runtime: Schema.optional(RuntimeSnapshot),
  lastEvents: Schema.Array(Schema.Any),
}).annotate({ identifier: "UlmOperationStatusSummary" })
const OperationResumeBrief = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  generatedAt: Schema.String,
  checkpoint: Schema.optional(
    Schema.Struct({
      objective: Schema.String,
      stage: Schema.Literals(STAGES),
      status: Schema.Literals(OPERATION_STATUSES),
      summary: Schema.String,
      riskLevel: Schema.Literals(RISK_LEVELS),
      nextActions: Schema.Array(Schema.String),
      blockers: Schema.Array(Schema.String),
      activeTasks: Schema.Array(Schema.String),
      time: OperationTime,
    }).annotate({ identifier: "UlmOperationCheckpointBrief" }),
  ),
  health: Schema.Struct({
    ready: Schema.Boolean,
    status: Schema.Literals(["ready", "attention_required"]),
    gaps: Schema.Array(Schema.String),
  }).annotate({ identifier: "UlmResumeHealth" }),
  artifacts: Schema.Struct({
    operation: Schema.Boolean,
    reports: ReportArtifacts,
    runtimeSummary: Schema.Boolean,
    findings: Schema.Finite,
    evidence: Schema.Finite,
  }).annotate({ identifier: "UlmResumeArtifacts" }),
  runtime: Schema.optional(RuntimeSnapshot),
  recommendedTools: Schema.Array(Schema.String),
  continuationPrompt: Schema.String,
  lastEvents: Schema.Array(Schema.Any),
}).annotate({ identifier: "UlmOperationResumeBrief" })
const OperationAuditResult = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  generatedAt: Schema.String,
  ok: Schema.Boolean,
  checks: Schema.Struct({
    resume: Schema.Struct({
      ok: Schema.Boolean,
      status: Schema.Literals(["ready", "attention_required"]),
      gaps: Schema.Array(Schema.String),
    }),
    finalHandoff: Schema.Struct({
      ok: Schema.Boolean,
      status: Schema.Literals(["ready", "attention_required"]),
      gaps: Schema.Array(Schema.String),
      counts: Schema.Struct({
        findings: Schema.Finite,
        reportReady: Schema.Finite,
        validated: Schema.Finite,
        candidates: Schema.Finite,
        rejected: Schema.Finite,
      }),
    }),
  }).annotate({ identifier: "UlmAuditChecks" }),
  blockers: Schema.Array(Schema.String),
  recommendedTools: Schema.Array(Schema.String),
  files: Schema.Struct({
    json: Schema.String,
    markdown: Schema.String,
  }).annotate({ identifier: "UlmAuditFiles" }),
}).annotate({ identifier: "UlmOperationAuditResult" })
export const UlmTemplateStartPayload = Schema.Struct({
  operationID: Schema.optional(Schema.String),
  template: UlmTemplateID,
  objective: Schema.String,
  targetDurationHours: Schema.optional(Schema.Number),
  trustLevel: Schema.optional(UlmTrustLevel),
  scanProfile: Schema.optional(UlmScanProfile),
  budgetUSD: Schema.optional(Schema.Number),
})
const TemplateStartResult = Schema.Struct({
  operationID: Schema.String,
  template: UlmTemplateID,
  files: Schema.Struct({
    goal: Schema.String,
    plan: Schema.String,
    graph: Schema.String,
    outline: Schema.String,
    memory: Schema.String,
  }),
}).annotate({ identifier: "UlmTemplateStartResult" })
export const UlmAuditWritePayload = Schema.Struct({
  eventLimit: Schema.optional(Schema.Number),
  staleAfterMinutes: Schema.optional(Schema.Number),
  minWords: Schema.optional(Schema.Number),
  requireOutlineBudget: Schema.optional(Schema.Boolean),
  minOutlineWordsPerPage: Schema.optional(Schema.Number),
  requireFindingSections: Schema.optional(Schema.Boolean),
  minFindingWords: Schema.optional(Schema.Number),
  finalHandoff: Schema.optional(Schema.Boolean),
})
export const UlmRecoverPayload = Schema.Struct({
  dryRun: Schema.optional(Schema.Boolean),
  maxTasks: Schema.optional(Schema.Number),
})
const RecoverResult = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literal("recover"),
  mode: Schema.Literal("planned"),
  supported: Schema.Boolean,
  dryRun: Schema.Boolean,
  command: Schema.String,
  reason: Schema.String,
  restartableJobs: Schema.Finite,
  skipped: Schema.Finite,
}).annotate({ identifier: "UlmRecoverResult" })
export const UlmDaemonPayload = Schema.Struct({
  maxRuntimeSeconds: Schema.optional(Schema.Number),
  cycleIntervalSeconds: Schema.optional(Schema.Number),
  maxCycles: Schema.optional(Schema.Number),
  schedulerCyclesPerTick: Schema.optional(Schema.Number),
})
const DaemonMetadata = Schema.Struct({
  running: Schema.Boolean,
  pid: Schema.optional(Schema.Finite),
  updatedAt: Schema.optional(Schema.String),
  stopped: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Schema.String),
  lockPath: Schema.String,
  heartbeatPath: Schema.String,
  logPath: Schema.String,
  heartbeat: Schema.optional(JsonObject),
  lock: Schema.optional(JsonObject),
}).annotate({ identifier: "UlmDaemonMetadata" })
const DaemonActionResult = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals(["start", "stop", "status"]),
  mode: Schema.Literals(["planned", "metadata"]),
  supported: Schema.Boolean,
  command: Schema.String,
  reason: Schema.String,
  daemon: DaemonMetadata,
}).annotate({ identifier: "UlmDaemonActionResult" })
const FinalArtifact = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  kind: Schema.Literals(["pdf", "html", "json", "markdown", "text", "unknown"]),
  exists: Schema.Boolean,
  path: Schema.String,
  size: Schema.optional(Schema.Finite),
  updatedAt: Schema.optional(Schema.String),
  fetchPath: Schema.String,
  openPath: Schema.String,
}).annotate({ identifier: "UlmFinalArtifact" })
const FinalArtifactList = Schema.Struct({
  operationID: Schema.String,
  finalDir: Schema.String,
  artifacts: Schema.Array(FinalArtifact),
}).annotate({ identifier: "UlmFinalArtifactList" })
const FinalArtifactMetadata = Schema.Struct({
  operationID: Schema.String,
  finalDir: Schema.String,
  artifact: FinalArtifact,
}).annotate({ identifier: "UlmFinalArtifactMetadata" })
export const UlmFinalArtifactOpenPayload = Schema.Struct({})
const FinalArtifactOpenResult = Schema.Struct({
  operationID: Schema.String,
  artifactID: Schema.String,
  mode: Schema.Literal("planned"),
  supported: Schema.Boolean,
  command: Schema.String,
  reason: Schema.String,
  artifact: FinalArtifact,
}).annotate({ identifier: "UlmFinalArtifactOpenResult" })
const CredentialRecord = Schema.Struct({
  credentialID: Schema.String,
  label: Schema.String,
  type: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String),
  rules: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  secret: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotate({ identifier: "UlmCredentialRecord" })
const CredentialListResult = Schema.Struct({
  operationID: Schema.String,
  index: Schema.String,
  credentials: Schema.Array(CredentialRecord),
}).annotate({ identifier: "UlmCredentialListResult" })
export const UlmCredentialCreatePayload = Schema.Struct({
  credentialID: Schema.optional(Schema.String),
  label: Schema.String,
  type: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  secret: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
  rules: Schema.optional(Schema.String),
})
const CredentialDeleteResult = Schema.Struct({
  operationID: Schema.String,
  credentialID: Schema.String,
  index: Schema.String,
  deleted: Schema.Boolean,
}).annotate({ identifier: "UlmCredentialDeleteResult" })
export const UlmCredentialMaterializePayload = Schema.Struct({
  credentialIDs: Schema.optional(Schema.Array(Schema.String)),
})
const CredentialMaterializeResult = Schema.Struct({
  operationID: Schema.String,
  envFile: Schema.String,
  credentials: Schema.Array(
    Schema.Struct({
      credentialID: Schema.String,
      label: Schema.String,
      variables: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "UlmCredentialMaterializeResult" })

export const UlmApi = HttpApi.make("ulm")
  .add(
    HttpApiGroup.make("ulm")
      .add(
        HttpApiEndpoint.get("list", UlmPaths.list, {
          query: UlmListQuery,
          success: described(Schema.Array(OperationStatusSummary), "ULMCode operation status list"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.list",
            summary: "List ULM operations",
            description: "List ULMCode operations with compact dashboard state.",
          }),
        ),
        HttpApiEndpoint.post("templateStart", UlmPaths.template, {
          payload: UlmTemplateStartPayload,
          success: described(TemplateStartResult, "ULMCode template operation start"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.template.start",
            summary: "Start ULM operation from template",
            description: "Create the minimal durable artifacts for a new template-backed ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.post("close", UlmPaths.close, {
          payload: UlmCloseOperationsPayload,
          success: described(CloseOperationsResult, "Closed ULM operations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.close",
            summary: "Close ULM operations",
            description: "Mark selected or all visible ULM operations complete for desktop cleanup.",
          }),
        ),
        HttpApiEndpoint.get("status", UlmPaths.status, {
          params: { operationID: Schema.String },
          query: UlmOperationQuery,
          success: described(OperationStatusSummary, "ULMCode operation status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.status",
            summary: "Get ULM operation status",
            description: "Read one ULMCode operation dashboard payload.",
          }),
        ),
        HttpApiEndpoint.get("resume", UlmPaths.resume, {
          params: { operationID: Schema.String },
          query: UlmResumeQuery,
          success: described(OperationResumeBrief, "ULMCode operation resume brief"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.resume",
            summary: "Get ULM operation resume brief",
            description: "Build a restart/compaction resume brief for one ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.get("audit", UlmPaths.audit, {
          params: { operationID: Schema.String },
          query: UlmAuditQuery,
          success: described(OperationAuditResult, "ULMCode operation audit"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.audit",
            summary: "Audit ULM operation handoff",
            description: "Run ULMCode final readiness checks for one operation.",
          }),
        ),
        HttpApiEndpoint.post("auditWrite", UlmPaths.audit, {
          params: { operationID: Schema.String },
          payload: UlmAuditWritePayload,
          success: described(OperationAuditResult, "ULMCode operation audit"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.audit.write",
            summary: "Write ULM operation audit",
            description: "Run and persist ULMCode final readiness checks for one operation.",
          }),
        ),
        HttpApiEndpoint.post("recover", UlmPaths.recover, {
          params: { operationID: Schema.String },
          payload: UlmRecoverPayload,
          success: described(RecoverResult, "ULMCode operation recovery metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.recover",
            summary: "Plan ULM operation recovery",
            description: "Return actionable recovery metadata for restartable ULMCode work without launching jobs from the API route.",
          }),
        ),
        HttpApiEndpoint.post("daemonStart", UlmPaths.daemonStart, {
          params: { operationID: Schema.String },
          payload: UlmDaemonPayload,
          success: described(DaemonActionResult, "ULMCode daemon start metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.daemon.start",
            summary: "Plan ULM runtime daemon start",
            description: "Return an operator command and current daemon metadata without spawning the runtime daemon from the API route.",
          }),
        ),
        HttpApiEndpoint.post("daemonStop", UlmPaths.daemonStop, {
          params: { operationID: Schema.String },
          payload: UlmDaemonPayload,
          success: described(DaemonActionResult, "ULMCode daemon stop metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.daemon.stop",
            summary: "Plan ULM runtime daemon stop",
            description: "Return an operator stop command and current daemon metadata without killing processes from the API route.",
          }),
        ),
        HttpApiEndpoint.post("daemonStatus", UlmPaths.daemonStatus, {
          params: { operationID: Schema.String },
          payload: UlmDaemonPayload,
          success: described(DaemonActionResult, "ULMCode daemon status metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.daemon.status",
            summary: "Read ULM runtime daemon status",
            description: "Read scheduler heartbeat, lock, and log metadata for one ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.get("finalArtifacts", UlmPaths.finalArtifacts, {
          params: { operationID: Schema.String },
          success: described(FinalArtifactList, "ULMCode final artifact metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.finalArtifacts",
            summary: "List ULM final artifacts",
            description: "List final handoff artifact metadata for one ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.get("finalArtifact", UlmPaths.finalArtifact, {
          params: { operationID: Schema.String, artifactID: Schema.String },
          success: described(FinalArtifactMetadata, "ULMCode final artifact metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.finalArtifact",
            summary: "Get ULM final artifact metadata",
            description: "Fetch metadata for one known final handoff artifact.",
          }),
        ),
        HttpApiEndpoint.post("finalArtifactOpen", UlmPaths.finalArtifactOpen, {
          params: { operationID: Schema.String, artifactID: Schema.String },
          payload: UlmFinalArtifactOpenPayload,
          success: described(FinalArtifactOpenResult, "ULMCode final artifact open metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.finalArtifact.open",
            summary: "Plan opening a ULM final artifact",
            description: "Return a local open command for one final handoff artifact without executing it in the API route.",
          }),
        ),
        HttpApiEndpoint.get("credentials", UlmPaths.credentials, {
          params: { operationID: Schema.String },
          success: described(CredentialListResult, "ULMCode operation credentials"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.credentials",
            summary: "List ULM operation credentials",
            description: "List redacted credential handles for one ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.post("credentialCreate", UlmPaths.credentials, {
          params: { operationID: Schema.String },
          payload: UlmCredentialCreatePayload,
          success: described(CredentialListResult, "ULMCode operation credentials"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.credential.create",
            summary: "Create ULM operation credential",
            description: "Store one operation-scoped credential and return the redacted credential list.",
          }),
        ),
        HttpApiEndpoint.delete("credentialDelete", UlmPaths.credential, {
          params: { operationID: Schema.String, credentialID: Schema.String },
          success: described(CredentialDeleteResult, "ULMCode credential deletion"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.credential.delete",
            summary: "Delete ULM operation credential",
            description: "Delete one operation-scoped credential from the redacted index and backing secret store.",
          }),
        ),
        HttpApiEndpoint.post("credentialMaterializeEnv", UlmPaths.materializeCredentials, {
          params: { operationID: Schema.String },
          payload: UlmCredentialMaterializePayload,
          success: described(CredentialMaterializeResult, "ULMCode credential env file"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.credential.materializeEnv",
            summary: "Materialize ULM credential environment",
            description: "Write selected credential secrets to a chmod 0600 env file for scoped command use.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "ulm", description: "Experimental ULMCode operation routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
