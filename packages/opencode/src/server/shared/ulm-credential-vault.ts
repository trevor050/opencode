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
      .scope, .tabs, .content { position: relative; z-index: 1; }
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
      .subtle {
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
      .secret-field input {
        padding-right: 8px;
      }
      .secret-toggle {
        flex: 0 0 auto;
        border: 0;
        border-left: 1px solid var(--line);
        background: var(--panel);
        color: var(--quiet);
        cursor: pointer;
        padding: 0 12px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .16em;
        text-transform: uppercase;
      }
      .secret-toggle:hover,
      .secret-toggle[aria-pressed="true"] {
        color: var(--accent);
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
      .clear, .delete, .materialize, .back {
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
      .review-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-top: 16px;
      }
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
      .requirements {
        display: grid;
        gap: 8px;
        margin-bottom: 16px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        padding: 12px;
      }
      .requirement-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--quiet);
        font-size: 10px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .requirement-row.met { color: var(--accent); }
      .requirement-row.missing { color: var(--danger); }
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
        .secret-toggle {
          border-left: 0;
          border-top: 1px solid var(--line);
          padding: 8px 12px;
          text-align: left;
        }
        .save { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="vault" aria-label="ULMCode Credential Vault">
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
          <button data-tab="overview">overview <span id="credential-count"></span></button>
        </nav>
        <div class="content">
          <div class="requirements">
            <div class="requirement-row"><span>credentials in plan</span><span id="expected-services">none</span></div>
            <div class="requirement-row"><span>still needed</span><span id="missing-services">none</span></div>
          </div>
          <section id="tab-add" class="view active">
            <div class="section-head">
              <span>Define Secret</span>
              <div class="mode">
                <button class="active" data-mode="structured">structured</button>
                <button data-mode="raw">raw editor</button>
              </div>
            </div>
            <form id="credential-form" class="stack">
              <div class="field"><span class="prefix">name</span><input name="label" placeholder="Credential name (e.g. router-admin)" required /></div>
              <div class="field">
                <span class="prefix">type</span>
                <select id="secret-type" name="type">
                  <option value="Router/Admin Login">Router/Admin Login</option>
                  <option value="Web App Login">Web App Login</option>
                  <option value="SSH / Local Auth">SSH / Local Auth</option>
                  <option value="API Token">API Token</option>
                  <option value="Session Cookie">Session Cookie</option>
                  <option value="Wi-Fi / Network">Wi-Fi / Network</option>
                  <option value="Raw Note">Raw Note</option>
                </select>
              </div>
              <div id="structured-fields" class="stack">
                <div class="field" data-row="username"><span class="prefix" data-prefix="username">user</span><input name="username" placeholder="Username or identity" /></div>
                <div class="field secret-field" data-row="password">
                  <span class="prefix" data-prefix="password">pass</span>
                  <input name="password" type="password" placeholder="Password" />
                  <button class="secret-toggle" type="button" data-toggle-secret="password" aria-label="Show password" aria-pressed="false">show</button>
                </div>
                <div class="field secret-field" data-row="secret">
                  <span class="prefix" data-prefix="secret">secret</span>
                  <input name="secret" type="password" placeholder="Token, private key, cookie, or other secret" />
                  <button class="secret-toggle" type="button" data-toggle-secret="secret" aria-label="Show secret" aria-pressed="false">show</button>
                </div>
                <div class="field" data-row="url"><span class="prefix" data-prefix="url">url</span><input name="url" placeholder="Login/admin URL" /></div>
                <div class="field" data-row="target"><span class="prefix" data-prefix="target">host</span><input name="target" placeholder="Target IP, hostname, SSID, or command" /></div>
                <div class="field" data-row="extra1"><span class="prefix" data-prefix="extra1">extra</span><input name="extra1" placeholder="Additional detail" /></div>
                <div class="field" data-row="extra2"><span class="prefix" data-prefix="extra2">extra</span><input name="extra2" placeholder="Additional detail" /></div>
              </div>
              <textarea id="raw-secret" class="raw" name="rawSecret" hidden placeholder="# Paste exact content (.env, notes, key material, raw JSON, browser steps)\n# Saved outside chat and redacted in the credential overview."></textarea>
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
          <section id="tab-overview" class="view">
            <div class="section-head">
              <span>Credential Overview</span>
              <div>
                <button id="back-to-add" class="back" type="button">[ back ]</button>
                <button id="refresh" class="clear" type="button">[ refresh ]</button>
              </div>
            </div>
            <div id="handles" class="handles"></div>
            <div class="review-actions">
              <span class="subtle">review, delete mistakes, then submit to agent</span>
              <button id="submit-review" class="save" type="button">submit to agent &gt;</button>
            </div>
          </section>
          <p id="message" class="message" role="status"></p>
        </div>
      </section>
    </main>
    <script>
      const params = new URLSearchParams(location.search)
      const operationID = params.get("operationID") || params.get("operation") || "default-operation"
      const directory = params.get("directory") || ""
      const apiQuery = directory ? "?directory=" + encodeURIComponent(directory) : ""
      const apiBase = "/ulm/operation/" + encodeURIComponent(operationID) + "/credentials"
      let mode = "structured"
      let credentials = []
      let expectedServices = []
      const fieldConfigs = {
        "Router/Admin Login": {
          username: ["user", "Router username"],
          password: ["pass", "Router/admin password"],
          url: ["url", "Router admin URL, e.g. https://192.168.1.1"],
          target: ["host", "Router IP or hostname"],
          extra1: ["mfa", "MFA or browser-login note"],
        },
        "Web App Login": {
          username: ["user", "Web/app username"],
          password: ["pass", "Web/app password"],
          url: ["url", "Application login URL"],
          target: ["scope", "Authorized app, host, or environment"],
          extra1: ["mfa", "MFA or SSO expectation"],
        },
        "SSH / Local Auth": {
          username: ["user", "SSH/local username"],
          password: ["pass", "Password or passphrase, if needed"],
          secret: ["key", "Private key or key note, if needed"],
          target: ["host", "ssh user@host, IP, or hostname"],
          extra1: ["port", "SSH port, default 22"],
        },
        "API Token": {
          username: ["id", "Key ID, service account, or owner"],
          secret: ["token", "API token or bearer token"],
          url: ["url", "API base URL or dashboard URL"],
          target: ["scope", "Allowed API scope/use"],
          extra1: ["header", "Header name, e.g. Authorization"],
        },
        "Session Cookie": {
          username: ["user", "Associated user/account"],
          secret: ["cookie", "Cookie value or cookie header"],
          url: ["url", "Site or origin URL"],
          target: ["domain", "Cookie domain/path"],
          extra1: ["name", "Cookie name"],
        },
        "Wi-Fi / Network": {
          password: ["key", "Wi-Fi password / PSK"],
          target: ["ssid", "SSID or network name"],
          extra1: ["sec", "Security mode, e.g. WPA2/WPA3"],
          extra2: ["band", "Band/VLAN/location note"],
        },
        "Raw Note": {},
      }

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
          applyMode()
        })
      })

      function setSecretVisible(button, visible) {
        const row = button.closest("[data-row]")
        const input = row?.querySelector("input")
        if (!input) return
        input.type = visible ? "text" : "password"
        button.textContent = visible ? "hide" : "show"
        button.setAttribute("aria-label", (visible ? "Hide " : "Show ") + (row.dataset.row || "secret"))
        button.setAttribute("aria-pressed", visible ? "true" : "false")
      }

      document.querySelectorAll("[data-toggle-secret]").forEach((button) => {
        button.addEventListener("click", () => {
          const row = button.closest("[data-row]")
          const input = row?.querySelector("input")
          const isHidden = input?.type !== "text"
          setSecretVisible(button, isHidden)
        })
      })

      function resetSecretVisibility() {
        document.querySelectorAll("[data-toggle-secret]").forEach((button) => setSecretVisible(button, false))
      }

      function applyMode() {
        document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode))
        document.getElementById("structured-fields").hidden = mode === "raw"
        document.getElementById("raw-secret").hidden = mode !== "raw"
      }

      function applySecretType() {
        const selected = document.getElementById("secret-type").value
        const config = fieldConfigs[selected] || fieldConfigs["Router/Admin Login"]
        const forceRaw = selected === "Raw Note"
        if (forceRaw && mode !== "raw") mode = "raw"
        if (!forceRaw && mode === "raw" && !document.getElementById("raw-secret").value.trim()) mode = "structured"
        applyMode()
        ;["username", "password", "secret", "url", "target", "extra1", "extra2"].forEach((name) => {
          const row = document.querySelector('[data-row="' + name + '"]')
          const input = row?.querySelector("input")
          const prefix = row?.querySelector("[data-prefix]")
          const definition = config[name]
          if (!row || !input || !prefix) return
          row.hidden = !definition
          prefix.textContent = definition?.[0] || "extra"
          input.placeholder = definition?.[1] || "Additional detail"
        })
      }

      document.getElementById("secret-type").addEventListener("change", applySecretType)

      async function request(path, options = {}) {
        const response = await fetch(path, {
          ...options,
          headers: { "content-type": "application/json", ...(options.headers || {}) },
        })
        if (!response.ok) throw new Error((await response.text()) || response.statusText)
        return response.json()
      }

      function render() {
        document.getElementById("credential-count").textContent = credentials.length ? "(" + credentials.length + ")" : ""
        const credentialText = credentials.map((item) => [item.credentialID, item.label, item.type, item.username, item.url, item.target, ...(item.tags || [])].join(" ").toLowerCase()).join("\\n")
        const missingServices = expectedServices.filter((service) => !credentialText.includes(service))
        const expectedEl = document.getElementById("expected-services")
        const missingEl = document.getElementById("missing-services")
        expectedEl.textContent = expectedServices.length ? expectedServices.join(", ") : "none"
        missingEl.textContent = missingServices.length ? missingServices.join(", ") : "none"
        missingEl.parentElement.classList.toggle("missing", missingServices.length > 0)
        missingEl.parentElement.classList.toggle("met", expectedServices.length > 0 && missingServices.length === 0)
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
          : '<div class="subtle">No saved credentials</div>'
        root.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => remove(button.dataset.delete)))
        root.querySelectorAll("[data-env]").forEach((button) => button.addEventListener("click", () => materialize(button.dataset.env)))
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch])
      }

      async function load() {
        try {
          const result = await request(apiBase + apiQuery)
          credentials = result.credentials || []
          expectedServices = result.expectedServices || []
          render()
        } catch (error) {
          setMessage("load failed: " + error.message, true)
        }
      }

      async function save(payload) {
        const result = await request(apiBase + apiQuery, { method: "POST", body: JSON.stringify(payload) })
        credentials = result.credentials || []
        expectedServices = result.expectedServices || expectedServices
        render()
        selectedTab("overview")
        setMessage("credential saved. raw secret stayed out of chat.")
      }

      async function remove(credentialID) {
        await request(apiBase + "/" + encodeURIComponent(credentialID) + apiQuery, { method: "DELETE" })
        await load()
        setMessage("credential deleted: " + credentialID)
      }

      async function materialize(credentialID) {
        const result = await request(apiBase + "/materialize-env" + apiQuery, {
          method: "POST",
          body: JSON.stringify({ credentialIDs: [credentialID] }),
        })
        setMessage("env file ready: " + result.envFile)
      }

      async function submitReview() {
        const result = await request(apiBase + "/submit" + apiQuery, { method: "POST", body: JSON.stringify({}) })
        credentials = result.credentials || []
        expectedServices = result.expectedServices || expectedServices
        render()
        setMessage("credential review submitted to agent: " + credentials.length + " credential(s)")
      }

      function visibleFormValue(data, name) {
        const row = document.querySelector('[data-row="' + name + '"]')
        if (row?.hidden) return undefined
        const value = String(data.get(name) || "")
        return value.trim() || undefined
      }

      document.getElementById("credential-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const label = String(data.get("label") || "").trim()
        if (!label) return
        const extraNotes = []
        ;["extra1", "extra2"].forEach((name) => {
          const row = document.querySelector('[data-row="' + name + '"]')
          if (row?.hidden) return
          const value = String(data.get(name) || "").trim()
          const prefix = row?.querySelector("[data-prefix]")?.textContent?.trim()
          if (value) extraNotes.push((prefix || name) + ": " + value)
        })
        const notes = [
          String(data.get("notes") || "").trim(),
          extraNotes.length ? "Additional fields:\\n- " + extraNotes.join("\\n- ") : "",
        ].filter(Boolean).join("\\n\\n") || undefined
        try {
          await save({
            label,
            type: String(data.get("type") || "").trim() || undefined,
            username: mode === "structured" ? visibleFormValue(data, "username") : undefined,
            password: mode === "structured" ? visibleFormValue(data, "password") : undefined,
            secret: mode === "structured" ? visibleFormValue(data, "secret") : String(data.get("rawSecret") || "") || undefined,
            url: mode === "structured" ? visibleFormValue(data, "url") : undefined,
            target: mode === "structured" ? visibleFormValue(data, "target") : "raw vault item",
            rules: String(data.get("rules") || "").trim() || undefined,
            notes,
            tags: [mode],
          })
          form.reset()
          resetSecretVisibility()
          applySecretType()
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
      document.getElementById("back-to-add").addEventListener("click", () => selectedTab("add"))
      document.getElementById("submit-review").addEventListener("click", () => submitReview().catch((error) => setMessage("submit failed: " + error.message, true)))
      applySecretType()
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
