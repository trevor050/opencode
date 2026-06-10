import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"

export function OperatorAutoResume(props: {
  timeoutAt?: string
  resetTimeoutAt?: string
}) {
  const { theme } = useTheme()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  const remainingSeconds = createMemo(() => {
    const parsed = Date.parse(resolveOperatorAutoResumeDeadline(props) ?? "")
    if (!Number.isFinite(parsed)) return undefined
    return Math.max(0, Math.ceil((parsed - now()) / 1000))
  })

  return (
    <Show when={props.timeoutAt}>
      <text fg={theme.warning}>auto-resumes in {remainingSeconds() ?? 0}s</text>
    </Show>
  )
}

export function resolveOperatorAutoResumeDeadline(input: { timeoutAt?: string; resetTimeoutAt?: string }) {
  const timeoutAt = Date.parse(input.timeoutAt ?? "")
  const resetTimeoutAt = Date.parse(input.resetTimeoutAt ?? "")
  if (!Number.isFinite(timeoutAt)) return input.resetTimeoutAt
  if (!Number.isFinite(resetTimeoutAt)) return input.timeoutAt
  return resetTimeoutAt > timeoutAt ? input.resetTimeoutAt : input.timeoutAt
}
