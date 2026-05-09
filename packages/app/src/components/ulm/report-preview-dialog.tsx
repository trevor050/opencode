import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"

export function UlmReportPreviewDialog(props: {
  title: string
  html: string
  htmlPath: string
  pdfPath?: string
  openPath?: (path: string) => Promise<void> | void
}) {
  return (
    <Dialog
      size="full"
      title="Report preview"
      description={<span class="truncate text-13-regular text-text-weak">{props.title}</span>}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-3 bg-background-base p-3">
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-border-weaker-base bg-surface-base px-3 py-2">
          <div class="min-w-0">
            <div class="text-11-medium uppercase text-text-weak">final report</div>
            <div class="mt-0.5 truncate text-12-regular text-text-base">{props.htmlPath}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={props.pdfPath && props.openPath}>
              <Button icon="review" size="small" variant="secondary" onClick={() => void props.openPath?.(props.pdfPath!)}>
                Open PDF
              </Button>
            </Show>
            <Show when={props.openPath}>
              <Button icon="open-file" size="small" variant="ghost" onClick={() => void props.openPath?.(props.htmlPath)}>
                Open HTML
              </Button>
            </Show>
          </div>
        </div>
        <iframe
          title={props.title}
          srcdoc={props.html}
          sandbox=""
          class="min-h-[520px] flex-1 rounded-[8px] border border-border-weaker-base bg-white"
        />
      </div>
    </Dialog>
  )
}

export function UlmTextArtifactDialog(props: {
  title: string
  text: string
  path: string
  kind: string
  openPath?: (path: string) => Promise<void> | void
}) {
  const [mode, setMode] = createSignal<"preview" | "source">("preview")
  const [query, setQuery] = createSignal("")
  const isMarkdown = () => props.path.endsWith(".md") || props.kind === "markdown"
  const sourceText = createMemo(() => {
    if (!props.path.endsWith(".json")) return props.text
    try {
      return JSON.stringify(JSON.parse(props.text), null, 2)
    } catch {
      return props.text
    }
  })
  const searchText = createMemo(() => query().trim().toLowerCase())
  const filteredText = createMemo(() => {
    const term = searchText()
    if (!term) return sourceText()
    return sourceText()
      .split("\n")
      .filter((line) => line.toLowerCase().includes(term))
      .join("\n")
  })
  const matchCount = createMemo(() => {
    const term = searchText()
    if (!term) return 0
    return sourceText()
      .split("\n")
      .filter((line) => line.toLowerCase().includes(term)).length
  })
  const showMarkdownPreview = () => isMarkdown() && mode() === "preview" && !searchText()

  return (
    <Dialog
      size="x-large"
      title={props.title}
      description={<span class="truncate text-13-regular text-text-weak">{props.path}</span>}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-3 bg-background-base p-3">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border-weaker-base bg-surface-base px-3 py-2">
          <div class="min-w-0">
            <div class="text-11-medium uppercase text-text-weak">artifact preview</div>
            <div class="mt-0.5 truncate text-12-regular text-text-base">{props.kind}</div>
          </div>
          <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <Show when={isMarkdown()}>
              <div class="flex rounded-[6px] border border-border-weaker-base bg-background-base p-0.5">
                <button
                  type="button"
                  class={`rounded-[5px] px-2 py-1 text-12-medium ${mode() === "preview" ? "bg-surface-base text-text-strong" : "text-text-weak"}`}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  class={`rounded-[5px] px-2 py-1 text-12-medium ${mode() === "source" ? "bg-surface-base text-text-strong" : "text-text-weak"}`}
                  onClick={() => setMode("source")}
                >
                  Source
                </button>
              </div>
            </Show>
            <label class="flex min-w-[180px] max-w-[280px] flex-1 items-center rounded-[6px] border border-border-weaker-base bg-background-base px-2 py-1">
              <span class="sr-only">Find in artifact</span>
              <input
                class="min-w-0 flex-1 bg-transparent text-12-regular text-text-base outline-none placeholder:text-text-disabled"
                placeholder="Find text"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <Show when={searchText()}>
                <span class="ml-2 text-11-medium text-text-weak">{matchCount()}</span>
              </Show>
            </label>
            <Show when={props.openPath}>
              <Button icon="open-file" size="small" variant="ghost" onClick={() => void props.openPath?.(props.path)}>
                Open file
              </Button>
            </Show>
          </div>
        </div>
        <Switch>
          <Match when={showMarkdownPreview()}>
            <div class="min-h-[420px] flex-1 overflow-auto rounded-[8px] border border-border-weaker-base bg-background-stronger p-4">
              <Markdown text={props.text} cacheKey={props.path} class="text-13-regular" />
            </div>
          </Match>
          <Match when={true}>
            <pre class="min-h-[420px] flex-1 overflow-auto whitespace-pre-wrap rounded-[8px] border border-border-weaker-base bg-background-stronger p-4 text-12-regular leading-5 text-text-base">
              {filteredText() || (searchText() ? "No matching lines." : "")}
            </pre>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
