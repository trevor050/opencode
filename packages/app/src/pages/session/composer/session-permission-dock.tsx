import { For, Show, createSignal, onMount } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { OperatorAutoResume } from "./operator-auto-resume"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const [pausedUntil, setPausedUntil] = createSignal(0)
  let root: HTMLDivElement | undefined
  let lastTouch = 0

  const touchOperatorPrompt = () => {
    if (!props.request.timeoutAt) return
    const now = Date.now()
    setPausedUntil(now + 30_000)
    if (now - lastTouch < 5_000) return
    lastTouch = now
    void sdk().client.permission.touch({
      requestID: props.request.id,
      holdMillis: 30_000,
    })
  }

  onMount(() => {
    if (!root) return
    makeEventListener(root, "pointerdown", touchOperatorPrompt, { passive: true, capture: true })
    makeEventListener(root, "focusin", touchOperatorPrompt, { capture: true })
    makeEventListener(root, "keydown", touchOperatorPrompt, { capture: true })
  })

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      ref={(el) => (root = el)}
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <OperatorAutoResume
              timeoutAt={props.request.timeoutAt}
              holdUntil={props.request.holdUntil}
              pausedUntil={pausedUntil()}
            />
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
