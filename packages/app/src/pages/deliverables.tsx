import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import type { UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, For, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useUlm } from "@/context/ulm"
import { finalPackagePath, operationChatPath, operationTitle, reportPackageState } from "@/utils/ulm-operation-ui"

function packageFiles(item: UlmOperationStatusSummary) {
  return [
    { label: "HTML", ready: item.reports.html },
    { label: "PDF", ready: item.reports.pdf },
    { label: "manifest", ready: item.reports.manifest },
    { label: "README", ready: item.reports.readme },
    { label: "runtime", ready: item.runtimeSummary },
  ]
}

function StatusPill(props: { ready: boolean; label: string }) {
  return (
    <div
      class="flex items-center justify-between gap-2 rounded-[6px] border px-2.5 py-2"
      classList={{
        "border-[color-mix(in_srgb,var(--border-weak-base)_80%,#14b86a)] bg-[color-mix(in_srgb,var(--background-base)_92%,#14b86a)]":
          props.ready,
        "border-border-weaker-base bg-background-base": !props.ready,
      }}
    >
      <span class="text-12-medium text-text-base">{props.label}</span>
      <span class="text-11-medium uppercase text-text-weak">{props.ready ? "ready" : "missing"}</span>
    </div>
  )
}

function DeliverableRow(props: { item: UlmOperationStatusSummary; base: string }) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const ulm = useUlm()
  const files = createMemo(() => packageFiles(props.item))
  const missing = createMemo(() => files().filter((file) => !file.ready).map((file) => file.label))
  const path = createMemo(() => finalPackagePath(props.item))

  const openFinal = async () => {
    const target = path()
    if (!target || !platform.openPath) return
    try {
      await platform.openPath(target)
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not open final package",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const runAudit = async () => {
    const result = await ulm.audit(props.item.operationID)
    if (!result) return
    showToast({
      variant: result.ok ? "success" : "error",
      title: result.ok ? "Package is ready" : "Package needs work",
      description: result.ok ? "No blockers reported." : result.blockers[0] ?? "Review operation details.",
    })
  }

  return (
    <article class="rounded-[8px] border border-border-weaker-base bg-surface-base p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-11-medium uppercase text-text-weak">
            {reportPackageState(props.item) === "ready" ? "ready to hand off" : "needs report files"}
          </div>
          <h2 class="mt-1 line-clamp-2 text-15-medium leading-5 text-text-strong">{operationTitle(props.item)}</h2>
          <div class="mt-2 text-13-regular text-text-weak">
            {missing().length ? `Missing ${missing().join(", ")}` : "HTML, PDF, and manifest are present."}
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <Button icon="speech-bubble" variant="ghost" size="small" onClick={() => navigate(operationChatPath(props.base, props.item))}>
            Chat
          </Button>
          <Button icon="status" variant="ghost" size="small" onClick={() => navigate(`${props.base}/operations/${props.item.operationID}`)}>
            Details
          </Button>
          <Button icon="checklist" variant="secondary" size="small" onClick={runAudit} disabled={ulm.store.actionLoading[props.item.operationID]}>
            Audit
          </Button>
          <Button icon="folder" variant="primary" size="small" onClick={openFinal} disabled={!path() || !platform.openPath}>
            Open files
          </Button>
        </div>
      </div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <For each={files()}>{(file) => <StatusPill label={file.label} ready={file.ready} />}</For>
      </div>
    </article>
  )
}

function DeliverableLane(props: { title: string; description: string; items: UlmOperationStatusSummary[]; base: string; empty: string }) {
  return (
    <section class="rounded-[8px] border border-border-weaker-base bg-background-stronger">
      <div class="flex items-center justify-between gap-3 border-b border-border-weaker-base px-4 py-3">
        <div class="min-w-0">
          <h2 class="text-13-medium text-text-strong">{props.title}</h2>
          <div class="mt-0.5 text-12-regular text-text-weak">{props.description}</div>
        </div>
        <div class="rounded-[6px] border border-border-weaker-base bg-surface-base px-2 py-1 text-12-medium text-text-base">
          {props.items.length}
        </div>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <Show
          when={props.items.length > 0}
          fallback={<div class="rounded-[8px] border border-dashed border-border-weak-base bg-surface-base p-4 text-13-regular text-text-weak">{props.empty}</div>}
        >
          <For each={props.items}>{(item) => <DeliverableRow item={item} base={props.base} />}</For>
        </Show>
      </div>
    </section>
  )
}

export default function DeliverablesPage() {
  const ulm = useUlm()
  const navigate = useNavigate()
  const params = useParams()
  const base = createMemo(() => `/${params.dir}`)
  const operations = createMemo(() => ulm.store.operations)
  const readyRows = createMemo(() => operations().filter((item) => reportPackageState(item) === "ready"))
  const draftRows = createMemo(() => operations().filter((item) => reportPackageState(item) === "partial"))
  const missingRows = createMemo(() => operations().filter((item) => reportPackageState(item) === "missing"))
  const ready = createMemo(() => operations().filter((item) => reportPackageState(item) === "ready").length)
  const needsWork = createMemo(() => operations().length - ready())

  createEffect(() => {
    for (const item of operations().slice(0, 12)) {
      if (ulm.store.artifactsByID[item.operationID]) continue
      if (!item.root) continue
      void ulm.refreshArtifacts(item.operationID)
    }
  })

  return (
    <main class="size-full overflow-auto bg-background-base">
      <div class="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-11-medium uppercase text-text-weak">ULMCode Desktop</div>
            <h1 class="mt-1 text-24-medium text-text-strong">Reports</h1>
            <div class="mt-1 max-w-170 text-13-regular leading-5 text-text-base">
              Handoff readiness by operation: final packages, drafts in progress, and runs with no report artifacts yet.
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button icon="refresh" variant="secondary" size="normal" onClick={() => void ulm.refresh()} disabled={ulm.store.refreshing}>
              Refresh
            </Button>
            <Button icon="status" variant="primary" size="normal" onClick={() => navigate(`${base()}/operations`)}>
              Operations
            </Button>
          </div>
        </header>

        <div class="grid gap-2 md:grid-cols-2">
          <div class="rounded-[8px] border border-border-weaker-base bg-surface-base px-4 py-3">
            <div class="text-22-medium text-text-strong">{ready()}</div>
            <div class="mt-1 text-12-medium uppercase text-text-weak">ready to hand off</div>
          </div>
          <div class="rounded-[8px] border border-border-weaker-base bg-surface-base px-4 py-3">
            <div class="text-22-medium text-text-strong">{needsWork()}</div>
            <div class="mt-1 text-12-medium uppercase text-text-weak">missing files</div>
          </div>
        </div>

        <DeliverableLane
          title="Ready to hand off"
          description="Final HTML, PDF, and manifest are present."
          items={readyRows()}
          base={base()}
          empty="No complete report packages yet."
        />
        <DeliverableLane
          title="Drafts and partial packages"
          description="Some report material exists, but the handoff is not complete."
          items={draftRows()}
          base={base()}
          empty="No draft packages right now."
        />
        <DeliverableLane
          title="No report artifacts"
          description="Operations that still need report generation or packaging."
          items={missingRows()}
          base={base()}
          empty="Every operation has at least some report material."
        />
      </div>
    </main>
  )
}
