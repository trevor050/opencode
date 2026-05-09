import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import type { UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, For, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useUlm } from "@/context/ulm"
import { currentOperationFilesPath, operationCounts, operationTitle, reportPackageState } from "@/utils/ulm-operation-ui"

type Tone = "neutral" | "good" | "warn" | "danger" | "info"

const toneClass: Record<Tone, string> = {
  neutral: "border-border-weaker-base bg-surface-base text-text-base",
  good: "border-[color-mix(in_srgb,var(--border-weak-base)_80%,#14b86a)] bg-[color-mix(in_srgb,var(--background-base)_92%,#14b86a)] text-text-strong",
  warn: "border-[color-mix(in_srgb,var(--border-weak-base)_70%,#d89b1d)] bg-[color-mix(in_srgb,var(--background-base)_90%,#d89b1d)] text-text-strong",
  danger:
    "border-[color-mix(in_srgb,var(--border-weak-base)_68%,#d84f45)] bg-[color-mix(in_srgb,var(--background-base)_90%,#d84f45)] text-text-strong",
  info: "border-[color-mix(in_srgb,var(--border-weak-base)_75%,#3882d8)] bg-[color-mix(in_srgb,var(--background-base)_92%,#3882d8)] text-text-strong",
}

function Chip(props: { tone?: Tone; children: string | number }) {
  return (
    <span class={`inline-flex h-6 items-center rounded-[6px] border px-2 text-12-medium ${toneClass[props.tone ?? "neutral"]}`}>
      {props.children}
    </span>
  )
}

function updatedAt(item: UlmOperationStatusSummary) {
  return item.operation?.time.updated || item.goal?.updatedAt || item.operation?.time.created
}

function timeAgo(value: string | undefined) {
  if (!value) return "unknown"
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function statusTone(status: string | undefined): Tone {
  if (status === "complete") return "good"
  if (status === "blocked") return "danger"
  if (status === "paused") return "warn"
  if (status === "running" || status === "planned") return "info"
  return "neutral"
}

function firstProblem(ulm: ReturnType<typeof useUlm>, item: UlmOperationStatusSummary) {
  const confidence = ulm.confidence(item)
  return confidence.reasons[0] ?? item.operation?.blockers[0] ?? item.operation?.nextActions[0] ?? "No next step recorded."
}

function operationFilesPath(item: UlmOperationStatusSummary) {
  return currentOperationFilesPath(item)
}

function SummaryBar(props: { operations: UlmOperationStatusSummary[] }) {
  const ulm = useUlm()
  const counts = createMemo(() => operationCounts(props.operations))
  const holds = createMemo(() => props.operations.filter((item) => ulm.confidence(item).level !== "ready").length)

  return (
    <div class="grid gap-2 md:grid-cols-3">
      <div class="rounded-[8px] border border-border-weaker-base bg-surface-base px-4 py-3">
        <div class="text-22-medium text-text-strong">{counts().running}</div>
        <div class="mt-1 text-12-medium uppercase text-text-weak">marked running</div>
      </div>
      <div class="rounded-[8px] border border-border-weaker-base bg-surface-base px-4 py-3">
        <div class="text-22-medium text-text-strong">{counts().open}</div>
        <div class="mt-1 text-12-medium uppercase text-text-weak">not closed</div>
      </div>
      <div class="rounded-[8px] border border-border-weaker-base bg-surface-base px-4 py-3">
        <div class="text-22-medium text-text-strong">{holds()}</div>
        <div class="mt-1 text-12-medium uppercase text-text-weak">need attention</div>
      </div>
    </div>
  )
}

function OperationCard(props: { item: UlmOperationStatusSummary; base: string }) {
  const ulm = useUlm()
  const navigate = useNavigate()
  const platform = usePlatform()
  const confidence = createMemo(() => ulm.confidence(props.item))
  const filesPath = createMemo(() => operationFilesPath(props.item))
  const packageLabel = createMemo(() => reportPackageState(props.item))

  const openFiles = async () => {
    const path = filesPath()
    if (!path || !platform.openPath) return
    try {
      await platform.openPath(path)
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not open operation files",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <article class="rounded-[8px] border border-border-weaker-base bg-surface-base p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          class="min-w-0 flex-1 text-left"
          onClick={() => navigate(`${props.base}/operations/${props.item.operationID}`)}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Chip tone={statusTone(props.item.operation?.status)}>{props.item.operation?.status ?? "untracked"}</Chip>
            <Chip tone={confidence().level === "blocked" ? "danger" : confidence().level === "attention" ? "warn" : "good"}>
              {confidence().level === "ready" ? "clear" : "needs attention"}
            </Chip>
            <Chip tone={packageLabel() === "ready" ? "good" : packageLabel() === "partial" ? "warn" : "neutral"}>
              {`report ${packageLabel()}`}
            </Chip>
          </div>
          <h2 class="mt-3 line-clamp-2 text-15-medium leading-5 text-text-strong">{operationTitle(props.item)}</h2>
          <div class="mt-2 line-clamp-2 text-13-regular leading-5 text-text-base">{firstProblem(ulm, props.item)}</div>
          <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-12-regular text-text-weak">
            <span>{props.item.findings.total} findings</span>
            <span>{props.item.evidence.total} evidence</span>
            <span>updated {timeAgo(updatedAt(props.item))}</span>
          </div>
        </button>

        <div class="flex shrink-0 flex-wrap gap-2">
          <Button
            icon="speech-bubble"
            variant="secondary"
            size="small"
            onClick={() => navigate(`${props.base}/session`)}
          >
            Chat
          </Button>
          <Button
            icon="folder"
            variant="ghost"
            size="small"
            onClick={openFiles}
            disabled={!platform.openPath || !filesPath()}
          >
            Files
          </Button>
        </div>
      </div>
    </article>
  )
}

function OperationDetail(props: { item: UlmOperationStatusSummary; base: string }) {
  const ulm = useUlm()
  const navigate = useNavigate()
  const platform = usePlatform()
  const confidence = createMemo(() => ulm.confidence(props.item))
  const reports = createMemo(() => [
    { label: "HTML", ready: props.item.reports.html },
    { label: "PDF", ready: props.item.reports.pdf },
    { label: "manifest", ready: props.item.reports.manifest },
    { label: "runtime", ready: props.item.runtimeSummary },
  ])

  const openFiles = async () => {
    const path = operationFilesPath(props.item)
    if (!path || !platform.openPath) return
    await platform.openPath(path)
  }

  return (
    <div class="flex flex-col gap-4">
      <section class="rounded-[8px] border border-border-weaker-base bg-surface-base p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <button
              type="button"
              class="mb-3 text-12-medium text-text-weak hover:text-text-base"
              onClick={() => navigate(`${props.base}/operations`)}
            >
              Back to operations
            </button>
            <h1 class="line-clamp-3 text-20-medium leading-7 text-text-strong">{operationTitle(props.item)}</h1>
            <div class="mt-3 flex flex-wrap gap-2">
              <Chip tone={statusTone(props.item.operation?.status)}>{props.item.operation?.status ?? "untracked"}</Chip>
              <Chip tone={confidence().level === "blocked" ? "danger" : confidence().level === "attention" ? "warn" : "good"}>
                {confidence().label}
              </Chip>
              <Chip>{`${props.item.evidence.total} evidence`}</Chip>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button icon="speech-bubble" variant="secondary" size="normal" onClick={() => navigate(`${props.base}/session`)}>
              Open chat
            </Button>
            <Button icon="folder" variant="primary" size="normal" onClick={openFiles} disabled={!operationFilesPath(props.item)}>
              Open files
            </Button>
          </div>
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section class="rounded-[8px] border border-border-weaker-base bg-surface-base p-4">
          <div class="text-13-medium text-text-strong">What needs doing</div>
          <div class="mt-3 flex flex-col gap-2">
            <For each={confidence().reasons.length ? confidence().reasons : props.item.operation?.nextActions ?? []}>
              {(item) => <div class="rounded-[6px] bg-background-base px-3 py-2 text-13-regular text-text-base">{item}</div>}
            </For>
            <Show when={!confidence().reasons.length && !(props.item.operation?.nextActions ?? []).length}>
              <div class="rounded-[6px] bg-background-base px-3 py-2 text-13-regular text-text-weak">
                No blocker or next action has been recorded.
              </div>
            </Show>
          </div>
        </section>

        <section class="rounded-[8px] border border-border-weaker-base bg-surface-base p-4">
          <div class="text-13-medium text-text-strong">Report status</div>
          <div class="mt-3 grid gap-2">
            <For each={reports()}>
              {(row) => (
                <div class="flex items-center justify-between rounded-[6px] bg-background-base px-3 py-2">
                  <span class="text-12-medium text-text-base">{row.label}</span>
                  <Chip tone={row.ready ? "good" : "neutral"}>{row.ready ? "ready" : "missing"}</Chip>
                </div>
              )}
            </For>
          </div>
        </section>
      </div>
    </div>
  )
}

export default function OperationsPage() {
  const ulm = useUlm()
  const navigate = useNavigate()
  const params = useParams()
  const base = createMemo(() => `/${params.dir}`)
  const operations = createMemo(() => ulm.store.operations)
  const counts = createMemo(() => operationCounts(operations()))
  const selected = createMemo(() =>
    params.operationID ? operations().find((item) => item.operationID === params.operationID) : undefined,
  )

  createEffect(() => {
    const id = params.operationID
    if (!id) return
    void ulm.refreshStatus(id)
    void ulm.refreshArtifacts(id)
  })

  return (
    <main class="size-full overflow-auto bg-background-base">
      <div class="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-11-medium uppercase text-text-weak">ULMCode Desktop</div>
            <h1 class="mt-1 text-24-medium text-text-strong">Operations</h1>
            <div class="mt-1 max-w-170 text-13-regular leading-5 text-text-base">
              Pick a run, open its chat, or jump straight to the files it produced.
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button icon="reset" variant="secondary" size="normal" onClick={() => void ulm.refresh()} disabled={ulm.store.refreshing}>
              Refresh
            </Button>
            <Button
              icon="checklist"
              variant="secondary"
              size="normal"
              onClick={() => void ulm.closeOperations()}
              disabled={ulm.store.refreshing || counts().open === 0}
            >
              Close all open
            </Button>
            <Button icon="speech-bubble" variant="primary" size="normal" onClick={() => navigate(`${base()}/session`)}>
              Chat
            </Button>
          </div>
        </header>

        <Show when={ulm.store.error}>
          {(error) => (
            <div class="rounded-[8px] border border-border-weaker-base bg-surface-base p-3 text-13-regular text-text-danger-base">
              {error()}
            </div>
          )}
        </Show>

        <Show
          when={params.operationID}
          fallback={
            <>
              <SummaryBar operations={operations()} />
              <section class="flex flex-col gap-2">
                <Show
                  when={operations().length > 0}
                  fallback={
                    <div class="rounded-[8px] border border-dashed border-border-weak-base bg-surface-base p-6 text-13-regular text-text-weak">
                      No operations yet. Start in chat and ask for a scoped pentest plan.
                    </div>
                  }
                >
                  <For each={operations()}>{(item) => <OperationCard item={item} base={base()} />}</For>
                </Show>
              </section>
            </>
          }
        >
          <Show
            when={selected()}
            fallback={
              <div class="rounded-[8px] border border-border-weaker-base bg-surface-base p-6">
                <div class="text-14-medium text-text-strong">Operation not found</div>
                <div class="mt-1 text-13-regular text-text-weak">Refresh the list or return to operations.</div>
                <Button class="mt-4" variant="secondary" size="normal" onClick={() => navigate(`${base()}/operations`)}>
                  Back
                </Button>
              </div>
            }
          >
            {(item) => <OperationDetail item={item()} base={base()} />}
          </Show>
        </Show>
      </div>
    </main>
  )
}
