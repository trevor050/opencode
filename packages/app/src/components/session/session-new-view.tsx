import { For, Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useLocal } from "@/context/local"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { isUlmDirectory } from "@/utils/ulm-workspace"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS = "size-full flex flex-col"
const ULM_ACTIONS = [
  {
    icon: "shield" as const,
    title: "Start operation",
    eyebrow: "scope first",
    body: "Authorization, constraints, targets, and plan before tools.",
    prompt:
      "Start a new authorized penetration test operation. Ask for missing authorization details first, then write a concrete operation plan with scope, constraints, evidence requirements, approval gates, and subagent usage before running tools.",
  },
  {
    icon: "warning" as const,
    title: "Clear blockers",
    eyebrow: "operator gate",
    body: "Approvals, stale jobs, missing evidence, unsafe moves.",
    prompt:
      "Resume the current operation and summarize blockers, pending approvals, stale jobs, missing evidence, and the safest next operator move.",
  },
  {
    icon: "archive" as const,
    title: "Package report",
    eyebrow: "handoff gate",
    body: "Report, manifest, support docs, and handoff gaps.",
    prompt:
      "Prepare the final deliverables for handoff. Run the operation audit, identify report gaps, and list exactly what is missing before final packaging.",
  },
  {
    icon: "terminal" as const,
    title: "Run evidence pass",
    eyebrow: "proof pass",
    body: "Findings, rejected leads, raw artifacts, report claims.",
    prompt:
      "Run an evidence consistency pass for the active operation. Compare findings, rejected leads, raw artifacts, report claims, and final deliverables; then list mismatches and the exact commands or files needed to close them.",
  },
]

interface NewSessionViewProps {
  worktree: string
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const prompt = usePrompt()
  const local = useLocal()
  const navigate = useNavigate()

  const sandboxes = createMemo(() => sync().project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const ulmWorkspace = createMemo(() => isUlmDirectory(projectRoot()))
  const operationsHref = createMemo(() => `/${base64Encode(projectRoot())}/operations`)
  const isWorktree = createMemo(() => {
    const project = sync().project
    if (!project) return false
    return sdk().directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync().data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }
  const seedPrompt = (value: string) => {
    if (ulmWorkspace() && local.agent.list().some((agent) => agent.name === "pentest")) {
      local.agent.set("pentest")
    }
    prompt.set([{ type: "text", content: value, start: 0, end: value.length }], value.length)
    requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
      editor?.focus()
    })
  }

  return (
    <div class={ROOT_CLASS}>
      <div class={ulmWorkspace() ? "h-5 shrink-0" : "h-12 shrink-0"} aria-hidden />
      <div
        class={
          ulmWorkspace()
            ? "flex-1 overflow-auto px-6 pb-24 pt-4 text-left"
            : "flex flex-1 items-center justify-center px-6 pb-30 text-center"
        }
      >
        <div
          class={
            ulmWorkspace()
              ? "mx-auto flex w-full max-w-[1120px] flex-col items-stretch gap-3 text-left"
              : "mx-auto flex w-full max-w-220 flex-col items-center gap-4 text-center"
          }
        >
          <Show
            when={!ulmWorkspace()}
            fallback={
              <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div class="text-10-medium uppercase text-text-weak">ULMCode Desktop</div>
                  <div class="mt-1 text-18-medium text-text-strong">New pentest</div>
                  <div class="mt-1 max-w-160 text-12-regular leading-5 text-text-weak">
                    Start a fresh scoped operation. Existing operation files and reports stay one click away.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(operationsHref())}
                  class="inline-flex items-center gap-2 rounded-[6px] border border-border-weaker-base bg-surface-base px-3 py-2 text-12-medium text-text-base transition-colors hover:border-border-weak-base hover:bg-surface-base-hover hover:text-text-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
                >
                  <Icon name="status" />
                  <span>Operations board</span>
                </button>
              </div>
            }
          >
            <div class="flex flex-col items-center gap-6">
              <Mark class="w-10" />
              <div class="text-20-medium text-text-strong">{language.t("session.new.title")}</div>
            </div>
          </Show>
          <div class="w-full flex flex-col gap-4 items-center">
            <Show
              when={!ulmWorkspace()}
              fallback={
                <div class="flex w-full flex-col gap-4 text-left">
                  <section>
                    <div class="mb-2 text-11-medium uppercase text-text-weak">Start from one clear action</div>
                    <div class="grid w-full grid-cols-1 gap-2 md:grid-cols-3">
                      <For each={ULM_ACTIONS.slice(0, 3)}>
                        {(action) => (
                          <button
                            type="button"
                            class="group flex min-h-22 flex-col gap-1 rounded-[8px] border border-border-weaker-base bg-surface-base px-3 py-3 text-left transition-colors hover:border-border-weak-base hover:bg-surface-base-hover focus:outline-none focus:ring-1 focus:ring-border-strong"
                            onClick={() => seedPrompt(action.prompt)}
                          >
                            <div class="flex items-center gap-2 text-13-medium text-text-strong">
                              <span class="flex size-6 items-center justify-center rounded-[6px] border border-border-weaker-base bg-background-base text-text-base group-hover:text-text-strong">
                                <Icon name={action.icon} />
                              </span>
                              <span class="min-w-0 truncate">{action.title}</span>
                            </div>
                            <div class="line-clamp-2 text-12-regular leading-4 text-text-weak">{action.body}</div>
                          </button>
                        )}
                      </For>
                    </div>
                  </section>
                </div>
              }
            >
              <div class="flex items-start justify-center gap-3 min-h-5">
                <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                  {getDirectory(projectRoot())}
                  <span class="text-text-strong">{getFilename(projectRoot())}</span>
                </div>
              </div>
              <div class="flex items-start justify-center gap-1.5 min-h-5">
                <Icon name="branch" size="small" class="mt-0.5 shrink-0" />
                <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                  {label(current())}
                </div>
              </div>
              <Show when={sync().project}>
                {(project) => (
                  <div class="flex items-start justify-center gap-3 min-h-5">
                    <div class="text-12-medium text-text-weak leading-5 min-w-0 max-w-160 break-words text-center">
                      {language.t("session.new.lastModified")}&nbsp;
                      <span class="text-text-strong">
                        {DateTime.fromMillis(project().time.updated ?? project().time.created)
                          .setLocale(language.intl())
                          .toRelative()}
                      </span>
                    </div>
                  </div>
                )}
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
