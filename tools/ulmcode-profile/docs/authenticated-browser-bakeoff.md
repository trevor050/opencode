# Authenticated Browser Bakeoff

ULMCode should treat authenticated browser control as a first-class 20-48 hour capability. The default candidate is `playwright_persistent`, which runs Microsoft Playwright MCP with a durable operation-local browser profile. Agent Browser stays available for lightweight day-to-day navigation.

## Candidates

- `playwright_persistent`: default workhorse for persistent profile, headed Chrome, screenshots, downloads, accessibility snapshots, and operation artifact output.
- `browser-mcp-existing-profile`: candidate for controlling an already logged-in local Chrome profile through a browser extension bridge.
- `chrome-devtools-companion`: companion for console, network, trace, and debugging evidence.

## Criteria

- persistent login/session state
- visible local browser support
- screenshot capture
- DOM/accessibility extraction
- download handling
- file upload handling
- console/network capture
- recovery after browser crash
- operation artifact logging
- MCP stability under long tasks

## Current Default

Use the profile MCP `playwright_persistent` for the dedicated Surface laptop. Set `ULMCODE_OPERATION_ID` before launch so profile, output, screenshots, downloads, and session output land under:

```text
.ulmcode/operations/<operation-id>/browser/
```

Browser MCP and Chrome DevTools MCP should be tested against the same criteria before they become default authenticated workflow tools.
