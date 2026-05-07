import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

const html = String.raw

export function credentialVaultHtml() {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ULMCode Credential Vault</title>
    <style>
      :root {
        --bg: #000;
        --panel: #050505;
        --panel-2: #0a0a0a;
        --panel-3: #111;
        --line: #222;
        --line-2: #333;
        --text: #eee;
        --muted: #a1a1aa;
        --quiet: #555;
        --faint: #444;
        --accent: #10b981;
        --danger: #f43f5e;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--muted);
        font: 12px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
      button, input, textarea, select { font: inherit; }
      .page {
        min-height: 100vh;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 32px 16px;
      }
      .vault {
        width: min(560px, 100%);
        min-height: 620px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 0 100px rgba(0,0,0,.8);
        position: relative;
        overflow: hidden;
      }
      .vault::before {
        content: "";
        pointer-events: none;
        position: absolute;
        inset: 0;
        background: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px);
        background-size: 100% 4px;
        opacity: .2;
      }
      .bar, .scope, .tabs, .content { position: relative; z-index: 1; }
      .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 8px;
        border-bottom: 1px solid var(--line);
        background: #000;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        background: var(--accent);
        color: #000;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .16em;
      }
      .badge::before {
        content: "";
        width: 9px;
        height: 9px;
        border: 2px solid #000;
        border-radius: 2px;
      }
      .esc, .subtle {
        color: var(--faint);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: .12em;
      }
      .scope {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 12px;
        border-bottom: 1px solid #111;
        background: #020202;
      }
      .label {
        display: block;
        margin-bottom: 4px;
        color: var(--faint);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: .18em;
      }
      .operation {
        color: #aaa;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .08em;
        overflow-wrap: anywhere;
      }
      .secure {
        color: var(--accent);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }
      .tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border-bottom: 1px solid var(--line);
      }
      .tabs button {
        border: 0;
        border-bottom: 1px solid transparent;
        background: transparent;
        color: var(--quiet);
        padding: 9px 8px;
        cursor: pointer;
        font-size: 10px;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .tabs button.active {
        background: var(--panel-3);
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      .content {
        min-height: 430px;
        padding: 16px;
      }
      .view { display: none; }
      .view.active { display: block; }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 8px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--line);
        color: #fff;
        font-size: 10px;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .mode {
        display: flex;
        gap: 12px;
      }
      .mode button {
        border: 0;
        border-bottom: 1px solid transparent;
        background: transparent;
        color: var(--faint);
        cursor: pointer;
        padding: 0 0 2px;
        font-size: 10px;
        text-transform: uppercase;
      }
      .mode button.active {
        color: #fff;
        border-bottom-color: #fff;
      }
      .stack { display: grid; gap: 12px; }
      .field {
        display: flex;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .prefix {
        width: 62px;
        flex: 0 0 62px;
        display: grid;
        place-items: center;
        border-right: 1px solid var(--line);
        background: var(--panel);
        color: var(--quiet);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }
      input, select, textarea {
        width: 100%;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--text);
        outline: 0;
        padding: 9px 12px;
      }
      input::placeholder, textarea::placeholder { color: #333; }
      .field:focus-within, textarea:focus {
        border-color: var(--quiet);
      }
      textarea {
        display: block;
        min-height: 74px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        resize: vertical;
        color: var(--accent);
      }
      textarea.raw {
        min-height: 285px;
        resize: vertical;
      }
      .divider {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--quiet);
        font-size: 9px;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .divider::after {
        content: "";
        flex: 1;
        height: 1px;
        background: var(--line);
      }
      .foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-top: 16px;
      }
      .save {
        border: 0;
        background: #eee;
        color: #000;
        padding: 9px 22px;
        cursor: pointer;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .save:disabled {
        cursor: not-allowed;
        opacity: .5;
      }
      .clear, .delete, .materialize {
        border: 0;
        background: transparent;
        color: var(--quiet);
        cursor: pointer;
        font-size: 9px;
        letter-spacing: .16em;
        text-transform: uppercase;
      }
      .delete:hover, .clear:hover { color: var(--danger); }
      .materialize:hover { color: var(--accent); }
      .handles {
        display: grid;
        gap: 8px;
        max-height: 380px;
        overflow: auto;
        padding-right: 4px;
      }
      .handle {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--line);
        background: var(--panel);
        padding: 12px;
      }
      .handle:hover { border-color: #444; }
      .handle-name {
        color: var(--text);
        margin-bottom: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .handle-meta {
        display: flex;
        gap: 8px;
        min-width: 0;
        color: var(--quiet);
        font-size: 10px;
      }
      .handle-code {
        color: var(--accent);
        flex: 0 0 auto;
      }
      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .drop {
        min-height: 330px;
        width: 100%;
        border: 1px dashed #333;
        background: var(--panel-2);
        color: var(--quiet);
        padding: 16px;
        resize: vertical;
      }
      .message {
        min-height: 18px;
        color: var(--accent);
        font-size: 10px;
        letter-spacing: .08em;
      }
      .error { color: var(--danger); }
      @media (max-width: 520px) {
        .page { padding: 10px; }
        .scope, .foot, .section-head {
          align-items: stretch;
          flex-direction: column;
        }
        .mode { justify-content: space-between; }
        .field { flex-direction: column; }
        .prefix {
          width: auto;
          place-items: start;
          padding: 6px 12px;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }
        .save { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="vault" aria-label="ULMCode Credential Vault">
        <div class="bar">
          <div><span class="badge">ULM_VAULT</span> <span class="subtle">v1</span></div>
          <button class="esc" type="button" onclick="window.close()">[ esc ]</button>
        </div>
        <div class="scope">
          <div>
            <span class="label">Operation</span>
            <span class="operation" id="operation-label"></span>
          </div>
          <div>
            <span class="label">Status</span>
            <span class="secure">session secure</span>
          </div>
        </div>
        <nav class="tabs" aria-label="Vault tabs">
          <button class="active" data-tab="add">add secret</button>
          <button data-tab="import">import</button>
          <button data-tab="handles">handles <span id="handle-count"></span></button>
        </nav>
        <div class="content">
          <section id="tab-add" class="view active">
            <div class="section-head">
              <span>Define Secret</span>
              <div class="mode">
                <button class="active" data-mode="structured">structured</button>
                <button data-mode="raw">raw editor</button>
              </div>
            </div>
            <form id="credential-form" class="stack">
              <div class="field"><span class="prefix">name</span><input name="label" placeholder="Handle name (e.g. lan-ssh-foothold)" required /></div>
              <div class="field">
                <span class="prefix">type</span>
                <select name="type">
                  <option>SSH / Local Auth</option>
                  <option>Web Login</option>
                  <option>API Token</option>
                  <option>Session Cookie</option>
                  <option>Freeform Note</option>
                </select>
              </div>
              <div id="structured-fields" class="stack">
                <div class="field"><span class="prefix">user</span><input name="username" placeholder="Username or identity" /></div>
                <div class="field"><span class="prefix">auth</span><input name="secret" type="password" placeholder="Password, token, key, or browser instruction" /></div>
                <div class="field"><span class="prefix">host</span><input name="target" placeholder="Target IP, URL, command, or domain" /></div>
              </div>
              <textarea id="raw-secret" class="raw" name="rawSecret" hidden placeholder="# Paste exact content (.env, notes, key material, raw JSON, browser steps)\n# Saved outside chat and redacted in the handle list."></textarea>
              <div class="divider">Rules of Engagement</div>
              <textarea name="rules" placeholder="Agent instructions, scope limits, acceptable use, reveal rules..."></textarea>
              <div class="divider">Operator Notes</div>
              <textarea name="notes" placeholder="Connection notes, workflow hints, MFA expectations, fallback behavior..."></textarea>
              <div class="foot">
                <span class="subtle">secret hidden from chat log</span>
                <button id="save-button" class="save" type="submit">save item &gt;</button>
              </div>
            </form>
          </section>
          <section id="tab-import" class="view">
            <div class="section-head"><span>Bulk Import</span></div>
            <textarea id="bulk" class="drop" placeholder="Paste multiple credentials or notes here.\n\nExample:\nlabel: LAN SSH foothold\nusername: trevor\nsecret: already authenticated with local key\ntarget: ssh trevor@192.168.1.151\nrules: use for authorized training box only"></textarea>
            <div class="foot">
              <span class="subtle">bulk paste becomes one raw vault item</span>
              <button id="save-bulk" class="save" type="button">save bulk &gt;</button>
            </div>
          </section>
          <section id="tab-handles" class="view">
            <div class="section-head">
              <span>Active Handles</span>
              <button id="refresh" class="clear" type="button">[ refresh ]</button>
            </div>
            <div id="handles" class="handles"></div>
          </section>
          <p id="message" class="message" role="status"></p>
        </div>
      </section>
    </main>
    <script>
      const params = new URLSearchParams(location.search)
      const operationID = params.get("operationID") || params.get("operation") || "default-operation"
      const apiBase = "/ulm/operation/" + encodeURIComponent(operationID) + "/credentials"
      let mode = "structured"
      let credentials = []

      document.getElementById("operation-label").textContent = operationID

      function setMessage(text, error = false) {
        const el = document.getElementById("message")
        el.textContent = text
        el.className = "message" + (error ? " error" : "")
      }

      function selectedTab(name) {
        document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === name))
        document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === "tab-" + name))
      }

      document.querySelectorAll("[data-tab]").forEach((item) => {
        item.addEventListener("click", () => selectedTab(item.dataset.tab))
      })

      document.querySelectorAll("[data-mode]").forEach((item) => {
        item.addEventListener("click", () => {
          mode = item.dataset.mode
          document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode))
          document.getElementById("structured-fields").hidden = mode === "raw"
          document.getElementById("raw-secret").hidden = mode !== "raw"
        })
      })

      async function request(path, options = {}) {
        const response = await fetch(path, {
          ...options,
          headers: { "content-type": "application/json", ...(options.headers || {}) },
        })
        if (!response.ok) throw new Error((await response.text()) || response.statusText)
        return response.json()
      }

      function render() {
        document.getElementById("handle-count").textContent = credentials.length ? "(" + credentials.length + ")" : ""
        const root = document.getElementById("handles")
        root.innerHTML = credentials.length
          ? credentials.map((item) => [
            '<article class="handle">',
            '<div>',
            '<div class="handle-name">' + escapeHtml(item.label) + '</div>',
            '<div class="handle-meta">',
            '<span class="handle-code">&gt; ' + escapeHtml(item.credentialID) + '</span>',
            '<span>::</span>',
            '<span class="truncate">' + escapeHtml(item.target || item.url || item.username || item.type || "stored secret") + '</span>',
            '</div>',
            '</div>',
            '<div>',
            '<button class="materialize" type="button" data-env="' + escapeHtml(item.credentialID) + '">env</button>',
            '<button class="delete" type="button" data-delete="' + escapeHtml(item.credentialID) + '">delete</button>',
            '</div>',
            '</article>',
          ].join("")).join("")
          : '<div class="subtle">No active handles</div>'
        root.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => remove(button.dataset.delete)))
        root.querySelectorAll("[data-env]").forEach((button) => button.addEventListener("click", () => materialize(button.dataset.env)))
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch])
      }

      async function load() {
        try {
          const result = await request(apiBase)
          credentials = result.credentials || []
          render()
        } catch (error) {
          setMessage("load failed: " + error.message, true)
        }
      }

      async function save(payload) {
        const result = await request(apiBase, { method: "POST", body: JSON.stringify(payload) })
        credentials = result.credentials || []
        render()
        selectedTab("handles")
        setMessage("credential handle added. raw secret stayed out of chat.")
      }

      async function remove(credentialID) {
        await request(apiBase + "/" + encodeURIComponent(credentialID), { method: "DELETE" })
        await load()
        setMessage("credential deleted: " + credentialID)
      }

      async function materialize(credentialID) {
        const result = await request(apiBase + "/materialize-env", {
          method: "POST",
          body: JSON.stringify({ credentialIDs: [credentialID] }),
        })
        setMessage("env file ready: " + result.envFile)
      }

      document.getElementById("credential-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const label = String(data.get("label") || "").trim()
        if (!label) return
        try {
          await save({
            label,
            type: String(data.get("type") || "").trim() || undefined,
            username: mode === "structured" ? String(data.get("username") || "").trim() || undefined : undefined,
            secret: mode === "structured" ? String(data.get("secret") || "") || undefined : String(data.get("rawSecret") || "") || undefined,
            target: mode === "structured" ? String(data.get("target") || "").trim() || undefined : "raw vault item",
            rules: String(data.get("rules") || "").trim() || undefined,
            notes: String(data.get("notes") || "").trim() || undefined,
            tags: [mode],
          })
          event.currentTarget.reset()
        } catch (error) {
          setMessage("save failed: " + error.message, true)
        }
      })

      document.getElementById("save-bulk").addEventListener("click", async () => {
        const value = document.getElementById("bulk").value.trim()
        if (!value) return
        try {
          await save({ label: "Bulk credential import " + new Date().toISOString(), type: "Bulk Import", secret: value, target: "bulk vault item", tags: ["bulk"] })
          document.getElementById("bulk").value = ""
        } catch (error) {
          setMessage("bulk save failed: " + error.message, true)
        }
      })

      document.getElementById("refresh").addEventListener("click", load)
      load()
    </script>
  </body>
</html>`
}

export const ulmCredentialVaultRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/ulm/credentials", Effect.succeed(HttpServerResponse.html(credentialVaultHtml())))
  }),
)
