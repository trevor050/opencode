import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useEvent } from "../context/event"
import { useProject } from "../context/project"
import { useRoute, useRouteData } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import {
  bindOperationSession,
  listOperationSessionBindings,
  readOperationPlanExcerpt,
  type SessionID,
} from "../ulm/operation"

type OperationStatus = {
  operationID: string
  operation?: {
    objective?: string
    stage?: string
    status?: string
    summary?: string
    riskLevel?: string
    nextActions?: string[]
    blockers?: string[]
  }
  goal?: {
    status?: string
    objective?: string
    targetDurationHours?: number
  }
  supervisor?: {
    action?: string
    reason?: string
    requiredNextTool?: string
    blockers?: string[]
    nextTools?: string[]
  }
  toolInventory?: {
    total?: number
    installed?: number
    missing?: number
    highValueMissing?: number
    installedHighValue?: string[]
    missingHighValue?: string[]
  }
  policies?: {
    foregroundCommand?: string
  }
  plans?: {
    operation?: boolean
    discoveryCharter?: boolean
    discoveryCharterApproval?: string
  }
  findings?: {
    total?: number
  }
  evidence?: {
    total?: number
  }
  reports?: Record<string, boolean>
  runtimeSummary?: boolean
  session?: {
    sessionID: string
    boundAt?: string
    source?: string
  }
}

type OperationAudit = {
  ok?: boolean
  blockers?: string[]
  recommendedTools?: string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function operationStatus(value: unknown): OperationStatus | undefined {
  const item = record(value)
  if (!item || typeof item.operationID !== "string") return
  const operation = record(item.operation)
  const findings = record(item.findings)
  const evidence = record(item.evidence)
  const reports = record(item.reports)
  const goal = record(item.goal)
  const supervisor = record(item.supervisor)
  const toolInventory = record(item.toolInventory)
  const policies = record(item.policies)
  const plans = record(item.plans)
  return {
    operationID: item.operationID,
    operation: operation
      ? {
          objective: typeof operation.objective === "string" ? operation.objective : undefined,
          stage: typeof operation.stage === "string" ? operation.stage : undefined,
          status: typeof operation.status === "string" ? operation.status : undefined,
          summary: typeof operation.summary === "string" ? operation.summary : undefined,
          riskLevel: typeof operation.riskLevel === "string" ? operation.riskLevel : undefined,
          nextActions: strings(operation.nextActions),
          blockers: strings(operation.blockers),
        }
      : undefined,
    goal: goal
      ? {
          status: typeof goal.status === "string" ? goal.status : undefined,
          objective: typeof goal.objective === "string" ? goal.objective : undefined,
          targetDurationHours: typeof goal.targetDurationHours === "number" ? goal.targetDurationHours : undefined,
        }
      : undefined,
    supervisor: supervisor
      ? {
          action: typeof supervisor.action === "string" ? supervisor.action : undefined,
          reason: typeof supervisor.reason === "string" ? supervisor.reason : undefined,
          requiredNextTool: typeof supervisor.requiredNextTool === "string" ? supervisor.requiredNextTool : undefined,
          blockers: strings(supervisor.blockers),
          nextTools: strings(supervisor.nextTools),
        }
      : undefined,
    toolInventory: toolInventory
      ? {
          total: typeof toolInventory.total === "number" ? toolInventory.total : undefined,
          installed: typeof toolInventory.installed === "number" ? toolInventory.installed : undefined,
          missing: typeof toolInventory.missing === "number" ? toolInventory.missing : undefined,
          highValueMissing: typeof toolInventory.highValueMissing === "number" ? toolInventory.highValueMissing : undefined,
          installedHighValue: strings(toolInventory.installedHighValue),
          missingHighValue: strings(toolInventory.missingHighValue),
        }
      : undefined,
    policies: policies
      ? {
          foregroundCommand: typeof policies.foregroundCommand === "string" ? policies.foregroundCommand : undefined,
        }
      : undefined,
    plans: plans
      ? {
          operation: typeof plans.operation === "boolean" ? plans.operation : undefined,
          discoveryCharter: typeof plans.discoveryCharter === "boolean" ? plans.discoveryCharter : undefined,
          discoveryCharterApproval:
            typeof plans.discoveryCharterApproval === "string" ? plans.discoveryCharterApproval : undefined,
        }
      : undefined,
    findings: findings && typeof findings.total === "number" ? { total: findings.total } : undefined,
    evidence: evidence && typeof evidence.total === "number" ? { total: evidence.total } : undefined,
    reports: reports
      ? Object.fromEntries(Object.entries(reports).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
      : undefined,
    runtimeSummary: typeof item.runtimeSummary === "boolean" ? item.runtimeSummary : undefined,
  }
}

function operationAudit(value: unknown): OperationAudit | undefined {
  const item = record(value)
  if (!item) return
  return {
    ok: typeof item.ok === "boolean" ? item.ok : undefined,
    blockers: strings(item.blockers),
    recommendedTools: strings(item.recommendedTools),
  }
}

function stageLabel(item: OperationStatus) {
  const stage = item.operation?.stage ?? "unknown"
  const status = item.operation?.status ?? "unknown"
  return `${stage}/${status}`
}

function countLabel(item: OperationStatus) {
  return `${item.findings?.total ?? 0} findings, ${item.evidence?.total ?? 0} evidence`
}

function readyReports(item: OperationStatus) {
  return Object.entries(item.reports ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key)
}

function planLabel(item: OperationStatus) {
  if (item.plans?.operation) return "full operation plan"
  if (item.plans?.discoveryCharter) return `discovery charter / ${item.plans.discoveryCharterApproval ?? "pending"}`
  return "missing"
}

function previewText(content: string | undefined) {
  if (!content) return "No plan artifact found yet."
  return content
    .split("\n")
    .filter((line) => line.trim().length)
    .slice(0, 18)
    .join("\n")
}

function mergeOperationUpdate(
  previous: OperationStatus | undefined,
  update: {
    operationID: string
    operation?: OperationStatus["operation"]
    goal?: OperationStatus["goal"]
    supervisor?: OperationStatus["supervisor"]
    toolInventory?: OperationStatus["toolInventory"]
    policies?: OperationStatus["policies"]
    plans?: OperationStatus["plans"]
    findings?: OperationStatus["findings"]
    evidence?: OperationStatus["evidence"]
    reports?: OperationStatus["reports"]
    runtimeSummary?: boolean
    session?: OperationStatus["session"]
  },
): OperationStatus {
  return {
    operationID: update.operationID,
    operation: update.operation ? { ...previous?.operation, ...update.operation } : previous?.operation,
    goal: update.goal ?? previous?.goal,
    supervisor: update.supervisor ?? previous?.supervisor,
    toolInventory: update.toolInventory ?? previous?.toolInventory,
    policies: update.policies ?? previous?.policies,
    plans: update.plans ?? previous?.plans,
    findings: update.findings ?? previous?.findings,
    evidence: update.evidence ?? previous?.evidence,
    reports: update.reports ?? previous?.reports,
    runtimeSummary: update.runtimeSummary ?? previous?.runtimeSummary,
    session: update.session ?? previous?.session,
  }
}

export function UlmOperations() {
  const sdk = useSDK()
  const sync = useSync()
  const event = useEvent()
  const route = useRoute()
  const project = useProject()
  const data = useRouteData("ulmOperations")
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)

  function root() {
    const current = project.instance.path()
    return current.worktree || current.directory || process.cwd()
  }

  async function attachSessionBindings(statuses: OperationStatus[]) {
    const bindings = await listOperationSessionBindings(root())
    const latest = new Map<string, (typeof bindings)[number]>()
    for (const binding of bindings) {
      if (!latest.has(binding.operationID)) latest.set(binding.operationID, binding)
    }
    return statuses.map((status) => {
      const binding = latest.get(status.operationID)
      if (!binding) return status
      return {
        ...status,
        session: {
          sessionID: String(binding.sessionID),
          boundAt: binding.boundAt,
          source: binding.source,
        },
      }
    })
  }

  const [items, itemsActions] = createResource(async () => {
    const result = await sdk.client.ulm.operation.list({ eventLimit: "2" })
    const statuses = (result.data ?? []).map(operationStatus).filter((item): item is OperationStatus => item !== undefined)
    return attachSessionBindings(statuses)
  })
  const [detail, detailActions] = createResource(
    () => data.operationID ?? "",
    async (operationID) => {
      if (!operationID) return
      const [status, audit] = await Promise.all([
        sdk.client.ulm.operation.status({ operationID, eventLimit: "8" }),
        sdk.client.ulm.operation.audit({ operationID, finalHandoff: "true" }).catch(() => undefined),
      ])
      const statuses = await attachSessionBindings(
        [operationStatus(status.data)].filter((item): item is OperationStatus => item !== undefined),
      )
      return {
        status: statuses[0],
        audit: operationAudit(audit?.data),
      }
    },
  )

  const visibleItems = createMemo(() => items() ?? [])
  const selectedItem = createMemo(() => visibleItems()[selected()])
  const activeStatus = createMemo(() => detail()?.status ?? selectedItem())
  const activeAudit = createMemo(() => detail()?.audit)
  const reports = createMemo(() => (activeStatus() ? readyReports(activeStatus()!) : []))
  const [planPreview, planPreviewActions] = createResource(
    () => activeStatus()?.operationID ?? "",
    async (operationID) => {
      if (!operationID) return
      return readOperationPlanExcerpt(root(), operationID, 2600)
    },
  )

  createEffect(() => {
    if (selected() < visibleItems().length) return
    setSelected(Math.max(0, visibleItems().length - 1))
  })

  createEffect(() => {
    const operationID = data.operationID
    if (!operationID) return
    const index = visibleItems().findIndex((item) => item.operationID === operationID)
    if (index >= 0) setSelected(index)
  })

  const refresh = () => {
    void itemsActions.refetch()
    if (data.operationID) void detailActions.refetch()
    void planPreviewActions.refetch()
  }

  async function sessionExists(sessionID: string) {
    if (sync.session.get(sessionID)) return true
    try {
      await sdk.client.session.get({ sessionID }, { throwOnError: true })
      return true
    } catch {
      return false
    }
  }

  async function openOperation(item: OperationStatus) {
    let sessionID = item.session?.sessionID
    if (sessionID && !(await sessionExists(sessionID))) sessionID = undefined
    if (!sessionID) {
      const created = await sdk.client.session.create({
        title: `ULM operation: ${item.operationID}`,
      })
      if (created.error || !created.data?.id) return
      sessionID = created.data.id
      await bindOperationSession(root(), {
        sessionID: sessionID as SessionID,
        operationID: item.operationID,
        source: "tui.ulm_operations.open",
      })
      await sync.session.refresh()
      refresh()
    } else {
      await sync.session.sync(sessionID)
    }
    route.navigate({ type: "session", sessionID })
  }

  useKeyboard((evt) => {
    if (evt.name === "r") {
      evt.preventDefault()
      refresh()
      return
    }
    if (evt.name === "up") {
      evt.preventDefault()
      setSelected((index) => Math.max(0, index - 1))
      return
    }
    if (evt.name === "down") {
      evt.preventDefault()
      setSelected((index) => Math.max(0, Math.min(visibleItems().length - 1, index + 1)))
      return
    }
    if (evt.name === "enter" && selectedItem()) {
      evt.preventDefault()
      void openOperation(selectedItem()!)
      return
    }
    if (evt.name === "backspace" && data.operationID) {
      evt.preventDefault()
      route.navigate({ type: "ulmOperations" })
      return
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      route.navigate({ type: "home" })
    }
  })

  const interval = setInterval(refresh, 15000)
  onCleanup(() => clearInterval(interval))

  event.on("operation.updated", (evt) => {
    itemsActions.mutate((current) => {
      const items = current ?? []
      const index = items.findIndex((item) => item.operationID === evt.properties.operationID)
      if (index === -1) return [mergeOperationUpdate(undefined, evt.properties), ...items]
      return items.map((item, itemIndex) =>
        itemIndex === index ? mergeOperationUpdate(item, evt.properties) : item,
      )
    })
    if (data.operationID !== evt.properties.operationID) return
    detailActions.mutate((current) => ({
      status: mergeOperationUpdate(current?.status, evt.properties),
      audit: current?.audit,
    }))
    if (evt.properties.artifact === "operation_audit") void detailActions.refetch()
    if (evt.properties.artifact === "operation_plan") void planPreviewActions.refetch()
  })

  return (
    <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          ULM Operations
        </text>
        <text fg={theme.textMuted}>r refresh / enter chat / backspace list / esc home</text>
      </box>
      <box flexDirection="row" flexGrow={1} gap={2} minHeight={0}>
        <box width={34} flexShrink={0} borderColor={theme.border} borderStyle="single" paddingLeft={1} paddingRight={1}>
          <Show when={!items.loading} fallback={<text fg={theme.textMuted}>Loading operations...</text>}>
            <Show when={visibleItems().length} fallback={<text fg={theme.textMuted}>No ULM operations found.</text>}>
              <For each={visibleItems().slice(0, 24)}>
                {(item, index) => (
                  <box
                    onMouseUp={() => {
                      setSelected(index())
                      void openOperation(item)
                    }}
                  >
                    <text
                      fg={index() === selected() ? theme.primary : item.operation?.status === "complete" ? theme.success : theme.text}
                      attributes={index() === selected() ? TextAttributes.BOLD : undefined}
                    >
                      {index() === selected() ? "> " : "  "}
                      {item.operationID}
                    </text>
                    <text fg={theme.textMuted}>
                      {"  "}
                      {stageLabel(item)} - {countLabel(item)}
                    </text>
                    <text fg={theme.textMuted}>
                      {"  "}
                      plan {planLabel(item)}
                    </text>
                    <text fg={theme.textMuted}>
                      {"  "}
                      chat {item.session?.sessionID ?? "not bound yet"}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </Show>
        </box>
        <box flexGrow={1} minWidth={0} borderColor={theme.border} borderStyle="single" paddingLeft={1} paddingRight={1}>
          <Show when={activeStatus()} fallback={<text fg={theme.textMuted}>Select an operation to inspect.</text>}>
            {(status) => (
              <box gap={1}>
                <box>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {status().operationID}
                  </text>
                  <text fg={theme.textMuted}>
                    {stageLabel(status())} / risk {status().operation?.riskLevel ?? "unknown"}
                  </text>
                </box>
                <box>
                  <text fg={theme.textMuted} wrapMode="word">
                    {status().operation?.objective ?? "No objective recorded."}
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    {status().operation?.summary ?? "No summary recorded."}
                  </text>
                </box>
                <box>
                  <text fg={theme.text}>
                    goal: {status().goal?.status ?? "missing"}
                    <span style={{ fg: theme.textMuted }}>
                      {status().goal?.targetDurationHours !== undefined ? ` / ${status().goal?.targetDurationHours}h` : ""}
                    </span>
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    supervisor: {status().supervisor?.action ?? "none"}
                    {status().supervisor?.reason ? ` - ${status().supervisor?.reason}` : ""}
                    {status().supervisor?.requiredNextTool ? ` / next ${status().supervisor?.requiredNextTool}` : ""}
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    tools:{" "}
                    {status().toolInventory
                      ? `${status().toolInventory?.installed ?? 0}/${status().toolInventory?.total ?? 0} installed, ${status().toolInventory?.highValueMissing ?? 0} high-value missing`
                      : "inventory missing; run tool_inventory"}
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    plan: {planLabel(status())}
                  </text>
                </box>
                <Show when={planPreview()}>
                  {(plan) => (
                    <box>
                      <text fg={theme.text}>
                        current plan
                        <span style={{ fg: theme.textMuted }}>
                          {plan().path ? ` / ${plan().path}` : ""}
                          {plan().truncated ? " / truncated" : ""}
                        </span>
                      </text>
                      <text fg={theme.textMuted} wrapMode="word">
                        {previewText(plan().content)}
                      </text>
                    </box>
                  )}
                </Show>
                <box>
                  <text fg={theme.text}>
                    {countLabel(status())}
                    <span style={{ fg: theme.textMuted }}>
                      {" "}
                      runtime {status().runtimeSummary ? "present" : "missing"}
                    </span>
                  </text>
                  <text fg={theme.textMuted}>reports: {reports().length ? reports().join(", ") : "none"}</text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {status().policies?.foregroundCommand ?? "commands expected over two minutes must run supervised/background"}
                  </text>
                </box>
                <Show when={status().operation?.nextActions?.length}>
                  <box>
                    <text fg={theme.text}>next actions</text>
                    <For each={status().operation?.nextActions ?? []}>
                      {(action) => <text fg={theme.textMuted} wrapMode="word">- {action}</text>}
                    </For>
                  </box>
                </Show>
                <Show when={(status().operation?.blockers?.length ?? 0) + (status().supervisor?.blockers?.length ?? 0)}>
                  <box>
                    <text fg={theme.warning}>blockers</text>
                    <For each={[...(status().operation?.blockers ?? []), ...(status().supervisor?.blockers ?? [])]}>
                      {(blocker) => <text fg={theme.textMuted} wrapMode="word">- {blocker}</text>}
                    </For>
                  </box>
                </Show>
                <Show when={activeAudit()}>
                  {(audit) => (
                    <box>
                      <text fg={audit().ok ? theme.success : theme.warning}>
                        audit: {audit().ok ? "ready" : "attention required"}
                      </text>
                      <For each={(audit().blockers ?? []).slice(0, 8)}>
                        {(blocker) => <text fg={theme.textMuted} wrapMode="word">- {blocker}</text>}
                      </For>
                      <Show when={audit().recommendedTools?.length}>
                        <text fg={theme.textMuted}>tools: {audit().recommendedTools!.join(", ")}</text>
                      </Show>
                    </box>
                  )}
                </Show>
              </box>
            )}
          </Show>
        </box>
      </box>
    </box>
  )
}
