import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import nodePath from "path"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { operationForSession, operationPath, type SessionID } from "../../ulm/operation"
import type { BuiltinTuiPlugin } from "../builtins"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const paths = useTuiPaths()
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const [operationFile, setOperationFile] = createSignal<string | undefined>()
  const path = createMemo(() => {
    const session = props.api.state.session.get(props.sessionID)
    const dir = session?.directory || props.api.state.path.directory || paths.cwd
    const out = abbreviateHome(dir, paths.home)
    const branch = session?.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined
    const text = branch ? `${out}:${branch}` : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  async function refreshOperationFile() {
    if (!props.sessionID) {
      setOperationFile(undefined)
      return
    }
    const root = props.api.state.path.worktree || props.api.state.path.directory || process.cwd()
    const operation = await operationForSession(root, props.sessionID as SessionID)
    setOperationFile(
      operation
        ? nodePath.join(operationPath(operation.worktree, operation.operationID), "goals", "operation-goal.json")
        : undefined,
    )
  }

  createEffect(() => {
    void refreshOperationFile()
  })

  onMount(() => {
    void refreshOperationFile()
    const interval = setInterval(() => void refreshOperationFile(), 5_000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>ULMCode includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      <Show
        when={operationFile()}
        fallback={
          <text fg={theme().textMuted}>
            op: <span style={{ fg: theme().text }}>no active operation</span>
          </text>
        }
      >
        {(file) => (
          <text>
            <span style={{ fg: theme().textMuted }}>op: </span>
            <span style={{ fg: theme().text }}>{file()}</span>
          </text>
        )}
      </Show>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>ULM</b>
        <span style={{ fg: theme().text }}>
          <b>Code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
