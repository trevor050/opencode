import { Button } from "@opencode-ai/ui/button"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { sortedRootSessions } from "./layout/helpers"

export default function Home() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()
  const [opening, setOpening] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  async function resolveOperationsDirectory() {
    const desktopDirectory = await window.api?.getUlmOperationsDirectory?.().catch(() => undefined)
    if (desktopDirectory) return desktopDirectory

    const ulmDirectory = sync.data.project.find((project) => project.worktree.includes("/ULMcode/opencode"))?.worktree
    if (ulmDirectory) return ulmDirectory

    const lastDirectory = server.projects.last()
    if (lastDirectory) return lastDirectory

    return sync.data.path.home
  }

  async function openRecentChat() {
    if (opening()) return
    setOpening(true)
    setError(undefined)

    try {
      const directory = await resolveOperationsDirectory()
      layout.projects.open(directory)
      layout.sidebar.open()
      server.projects.touch(directory)
      await sync.project.loadSessions(directory)

      const [store] = sync.child(directory, { bootstrap: false })
      const latest = sortedRootSessions(store, Date.now())[0]
      const slug = base64Encode(directory)
      navigate(latest ? `/${slug}/session/${latest.id}` : `/${slug}/session`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open recent chats")
      setOpening(false)
    }
  }

  createEffect(() => {
    if (opening()) return
    void openRecentChat()
  })

  return (
    <div class="min-h-full px-6 py-10 flex items-center justify-center">
      <div class="w-full max-w-160 flex flex-col gap-8">
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <div class="text-24-medium text-text-strong">ULMCode Desktop</div>
            <div class="text-13-regular text-text-weak">Opening recent chats</div>
          </div>
          <Button
            size="normal"
            variant="ghost"
            class="px-3 text-text-weak"
            onClick={() => dialog.show(() => <DialogSelectServer />)}
          >
            <div
              classList={{
                "size-2 rounded-full": true,
                [serverDotClass()]: true,
              }}
            />
            {server.name}
          </Button>
        </div>

        <div class="border border-border-weaker-base rounded-lg bg-surface-base px-5 py-5 flex items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <div class="text-14-medium text-text-strong">Chats drive operations</div>
            <div class="text-12-regular text-text-weak">
              ULMCode starts in the latest conversation, with operation status attached.
            </div>
            <Show when={error()}>
              {(message) => <div class="text-12-regular text-text-danger-base mt-2">{message()}</div>}
            </Show>
          </div>
          <Button size="large" class="px-4 shrink-0" onClick={openRecentChat}>
            {opening() ? "Opening" : "Open chats"}
          </Button>
        </div>
      </div>
    </div>
  )
}
