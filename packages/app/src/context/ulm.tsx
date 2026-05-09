import { createSimpleContext } from "@opencode-ai/ui/context"
import type {
  PermissionRequest,
  QuestionRequest,
  Session,
  UlmDaemonActionResult,
  UlmFinalArtifactList,
  UlmOperationAuditResult,
  UlmOperationResumeBrief,
  UlmOperationStatusSummary,
} from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import {
  applyOperationUpdated,
  confidenceForOperation,
  operationListFromResponse,
  pendingApprovalCounts,
  sortOperations,
} from "./ulm-state"

export type UlmApprovalItem = {
  type: "question" | "permission"
  session: Pick<Session, "id" | "title" | "parentID"> | undefined
  operationID: string | undefined
  request: QuestionRequest | PermissionRequest
}

function requestOperationID(value: QuestionRequest | PermissionRequest) {
  if (!("metadata" in value) || !value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) {
    return undefined
  }
  const metadata = value.metadata as Record<string, unknown>
  return typeof metadata.operationID === "string" ? metadata.operationID : undefined
}

function setStatus(setStore: SetStoreFunction<UlmStore>, status: UlmOperationStatusSummary | undefined) {
  if (!status) return
  setStore("statusByID", status.operationID, reconcile(status))
  setStore(
    "operations",
    produce((draft) => {
      const index = draft.findIndex((item) => item.operationID === status.operationID)
      if (index === -1) {
        draft.push(status)
        return
      }
      draft[index] = status
    }),
  )
  setStore("operations", (items) => sortOperations(items))
}

type UlmStore = {
  operations: UlmOperationStatusSummary[]
  statusByID: Record<string, UlmOperationStatusSummary | undefined>
  resumeByID: Record<string, UlmOperationResumeBrief | undefined>
  auditByID: Record<string, UlmOperationAuditResult | undefined>
  artifactsByID: Record<string, UlmFinalArtifactList | undefined>
  daemonByID: Record<string, UlmDaemonActionResult | undefined>
  loading: boolean
  refreshing: boolean
  detailLoading: Record<string, boolean | undefined>
  actionLoading: Record<string, boolean | undefined>
  error: string | undefined
}

export const { use: useUlm, provider: UlmProvider } = createSimpleContext({
  name: "ULM",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const [store, setStore] = createStore<UlmStore>({
      operations: [],
      statusByID: {},
      resumeByID: {},
      auditByID: {},
      artifactsByID: {},
      daemonByID: {},
      loading: true,
      refreshing: false,
      detailLoading: {},
      actionLoading: {},
      error: undefined,
    })
    const [loaded, setLoaded] = createSignal(false)

    async function refresh() {
      setStore("refreshing", true)
      setStore("error", undefined)
      try {
        const result = await sdk.client.ulm.operation.list({ eventLimit: "5" })
        setStore("operations", reconcile(sortOperations(operationListFromResponse(result.data)), { key: "operationID" }))
        setLoaded(true)
      } catch (error) {
        setStore("error", error instanceof Error ? error.message : String(error))
      } finally {
        setStore("loading", false)
        setStore("refreshing", false)
      }
    }

    async function refreshStatus(operationID: string) {
      setStore("detailLoading", operationID, true)
      setStore("error", undefined)
      try {
        const result = await sdk.client.ulm.operation.status({ operationID, eventLimit: "12" })
        setStatus(setStore, result.data)
      } catch (error) {
        setStore("error", error instanceof Error ? error.message : String(error))
      } finally {
        setStore("detailLoading", operationID, false)
      }
    }

    async function resume(operationID: string) {
      setStore("actionLoading", operationID, true)
      try {
        const result = await sdk.client.ulm.operation.resume({ operationID, eventLimit: "12" })
        setStore("resumeByID", operationID, result.data)
        return result.data
      } finally {
        setStore("actionLoading", operationID, false)
      }
    }

    async function audit(operationID: string) {
      setStore("actionLoading", operationID, true)
      try {
        const result = await sdk.client.ulm.operation.audit2.write({ operationID, eventLimit: 12, finalHandoff: true })
        setStore("auditByID", operationID, result.data)
        return result.data
      } finally {
        setStore("actionLoading", operationID, false)
      }
    }

    async function refreshArtifacts(operationID: string) {
      const result = await sdk.client.ulm.operation.finalArtifacts({ operationID })
      setStore("artifactsByID", operationID, result.data)
      return result.data
    }

    async function closeOperations(operationIDs?: string[]) {
      setStore("refreshing", true)
      setStore("error", undefined)
      try {
        const response = await fetch(
          `${sdk.url}/ulm/operation/close?directory=${encodeURIComponent(sdk.directory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ operationIDs }),
          },
        )
        if (!response.ok) throw new Error(`Close operations failed (${response.status})`)
        await refresh()
        return (await response.json()) as { closed: string[]; remaining: number }
      } catch (error) {
        setStore("error", error instanceof Error ? error.message : String(error))
      } finally {
        setStore("refreshing", false)
      }
    }

    async function daemonStatus(operationID: string) {
      const result = await sdk.client.ulm.operation.daemon.status({ operationID })
      setStore("daemonByID", operationID, result.data)
      return result.data
    }

    async function daemonStart(operationID: string) {
      setStore("actionLoading", operationID, true)
      try {
        const result = await sdk.client.ulm.operation.daemon.start({ operationID })
        setStore("daemonByID", operationID, result.data)
        return result.data
      } finally {
        setStore("actionLoading", operationID, false)
      }
    }

    async function daemonStop(operationID: string) {
      setStore("actionLoading", operationID, true)
      try {
        const result = await sdk.client.ulm.operation.daemon.stop({ operationID })
        setStore("daemonByID", operationID, result.data)
        return result.data
      } finally {
        setStore("actionLoading", operationID, false)
      }
    }

    const approvals = createMemo<UlmApprovalItem[]>(() => {
      const sessions = new Map(sync.data.session.map((session) => [session.id, session] as const))
      const items: UlmApprovalItem[] = []
      for (const [sessionID, requests] of Object.entries(sync.data.question)) {
        for (const request of requests ?? []) {
          items.push({ type: "question", request, session: sessions.get(sessionID), operationID: requestOperationID(request) })
        }
      }
      for (const [sessionID, requests] of Object.entries(sync.data.permission)) {
        for (const request of requests ?? []) {
          items.push({
            type: "permission",
            request,
            session: sessions.get(sessionID),
            operationID: requestOperationID(request),
          })
        }
      }
      return items
    })

    const source = createMemo(() => ({
      sessions: sync.data.session,
      questions: sync.data.question,
      permissions: sync.data.permission,
    }))

    function approvalCounts(operationID: string) {
      return pendingApprovalCounts(source(), operationID)
    }

    function confidence(operation: UlmOperationStatusSummary) {
      return confidenceForOperation(operation, approvalCounts(operation.operationID))
    }

    onMount(() => {
      void refresh()
      const interval = window.setInterval(() => void refresh(), 15_000)
      onCleanup(() => window.clearInterval(interval))
    })

    const unsub = sdk.event.on("operation.updated", (event) => {
      setStore("operations", (items) => applyOperationUpdated(items, event))
      const operationID = event.properties.operationID
      setStore("statusByID", operationID, (current) => {
        const [updated] = applyOperationUpdated(current ? [current] : [], event)
        return updated
      })
      if (store.statusByID[operationID]) void refreshStatus(operationID)
    })
    onCleanup(unsub)

    return {
      store,
      approvals,
      approvalCounts,
      confidence,
      refresh,
      refreshStatus,
      resume,
      audit,
      closeOperations,
      refreshArtifacts,
      daemonStatus,
      daemonStart,
      daemonStop,
      get loaded() {
        return loaded()
      },
    }
  },
})
