import { createMemo, createSignal, onCleanup, Show } from "solid-js"

export function OperatorAutoResume(props: {
  timeoutAt?: string
  holdUntil?: string
  pausedUntil?: number
}) {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  const paused = createMemo(() => (props.pausedUntil ?? 0) > now())
  const remainingSeconds = createMemo(() => {
    const parsed = Date.parse(props.timeoutAt ?? "")
    if (!Number.isFinite(parsed)) return undefined
    return Math.max(0, Math.ceil((parsed - now()) / 1000))
  })
  const holdSeconds = createMemo(() => {
    const parsed = Date.parse(props.holdUntil ?? "")
    if (!Number.isFinite(parsed)) return undefined
    return Math.max(0, Math.ceil((parsed - now()) / 1000))
  })

  return (
    <Show when={props.timeoutAt}>
      <span
        class="shrink-0 rounded-[6px] border bg-background-base px-2 py-1 text-12-medium text-text-base"
        classList={{
          "border-border-warning-base": !paused(),
          "border-border-success-base": paused(),
        }}
      >
        {paused()
          ? `auto-resume paused${holdSeconds() === undefined ? "" : `, ${holdSeconds()}s hold`}`
          : `auto-resumes in ${remainingSeconds() ?? 0}s`}
      </span>
    </Show>
  )
}
