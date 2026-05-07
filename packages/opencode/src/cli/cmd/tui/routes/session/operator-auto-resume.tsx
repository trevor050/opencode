import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"

export function OperatorAutoResume(props: {
  timeoutAt?: string
  holdUntil?: string
  pausedUntil?: number
}) {
  const { theme } = useTheme()
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
      <text fg={paused() ? theme.success : theme.warning}>
        {paused()
          ? `auto-resume paused while typing${holdSeconds() === undefined ? "" : ` (${holdSeconds()}s hold)`}`
          : `auto-resumes in ${remainingSeconds() ?? 0}s`}
      </text>
    </Show>
  )
}
