# Engagement Results

## Executive Summary
- Findings: 4
- Severity: critical=0, high=0, medium=3, low=1, info=0
- Sources: SRC-001(finding_log), SRC-002(handoff), SRC-003(evidence), SRC-004(subagent_results), SRC-005(subagent_results), SRC-006(subagent_results), SRC-007(subagent_results), SRC-008(subagent_results)

## Findings Narrative
### 1. CI workflow executes remote installer via curl|bash
- ID: FND-BP7A638K5S
- Severity: medium
- Confidence: 0.95
- Asset: GitHub Actions workflow: .github/workflows/review.yml
- Impact: If the install endpoint, DNS/TLS path, or upstream hosting is compromised, an attacker can achieve arbitrary code execution in the CI runner context, potentially impacting build artifacts, secrets available to the job, and repository operations performed by the workflow.
- Recommendation: Avoid `curl | bash` in CI. Prefer a pinned, integrity-verified install method (e.g., package manager with version pinning, checksum/signature verification, or vendoring the installer script at a pinned commit). If a script must be fetched, pin to an immutable version and verify a published checksum/signature before execution.

### 2. Tool permission policy blocks editing engagement artifacts (results/handoff)
- ID: FND-BWRDYG95XT
- Severity: medium
- Confidence: 0.9
- Asset: opencode cyber session tool permissions
- Impact: Cyber workflow audit trail can’t be maintained by subagents (cannot update results.md/handoff.md using the available editing mechanism). This can break engagement compliance requirements, reduce report quality, and prevent coordination updates from being captured in the canonical artifacts.
- Recommendation: Adjust the runtime/tool permission policy for cyber sessions to allow editing/writing of engagement artifacts (at minimum: `handoff.md`, `agents/*/results.md`, and optionally `reports/*`), or provide a dedicated non-interactive write tool that is permitted for these paths. Ensure the permission layer distinguishes between project code edits vs. engagement-artifact updates.

### 3. CI uses TOFU ssh-keyscan and writes AUR deploy key to disk
- ID: FND-KRX5XQD0QP
- Severity: medium
- Confidence: 0.9
- Asset: GitHub Actions workflow: .github/workflows/publish.yml (AUR publishing)
- Impact: A MITM on the CI network path could feed a malicious host key during `ssh-keyscan`, enabling credential capture or malicious pushes to the AUR repo. Writing the deploy key to disk increases the blast radius if the runner is compromised during job execution.
- Recommendation: Pin the expected AUR host key(s) (commit them in-repo or store as a protected secret) instead of `ssh-keyscan` TOFU. Prefer `ssh-agent` with an ephemeral key file and strict permissions, and consider using `known_hosts` with exact key material. Ensure secrets are least-privilege and job permissions are minimized.

### 4. Strict-isolation flags not set in current session; external skill directory present
- ID: FND-8PJK948RGC
- Severity: low
- Confidence: 0.75
- Asset: Operator runtime environment (local shell running cyber session)
- Impact: If strict-isolation mode is required for an engagement, running without the isolation flags can allow discovery/loading of skills or config outside the intended allowlist, increasing risk of skill/config leakage or unintended behavior drift between environments.
- Recommendation: Use the isolated profile launcher (e.g., `tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh`) and run via the generated `ulmcode-launch.sh`, which exports `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and `OPENCODE_DISABLE_PROJECT_CONFIG=1` and pins config via `OPENCODE_CONFIG_DIR/OPENCODE_CONFIG`. Optionally add a startup preflight that fails closed if cyber sessions start without these flags when isolation is expected.


## Subagent Result Consolidation
### /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/agents/ses_3c81e997bffeUeWcudNV7EeXJF/results.md
```markdown
# Subagent Results

- Session: ses_3c81e997bffeUeWcudNV7EeXJF
- Created: 2026-02-07T11:34:04.680Z

## Summary

- Role: report_writer (final synthesis)
- Read and normalized canonical artifacts: `engagement.md`, `finding.md`, `handoff.md`, `agents/*/results.md`, and `evidence/`.
- Updated required intermediate report artifacts in `reports/` with a concise smoke-test framing.
- Prepared for re-finalization so the bundle reflects the latest `finding.md` contents (including the harness blocker FND-BWRDYG95XT).

## Evidence Links

- Engagement root: `/Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82`
- Canonical findings: `finding.md`
- Intermediate report artifacts:
  - `reports/report-plan.md`
  - `reports/report-outline.md`
  - `reports/report-draft.md`
  - `reports/results.md`
  - `reports/remediation-plan.md`
```

### /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa9ffeQ7h7Df1Ol1NHtA/results.md
```markdown
# Subagent Results

- Session: ses_3c822ffa9ffeQ7h7Df1Ol1NHtA
- Created: 2026-02-07T11:29:16.380Z

## Summary
- TODO

## Evidence Links
- TODO
```

### /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa8ffeGaUlV8XyUJE0ZG/results.md
```markdown
# Subagent Results

- Session: ses_3c822ffa8ffeGaUlV8XyUJE0ZG
- Created: 2026-02-07T11:29:16.380Z

## Summary
- TODO

## Evidence Links
- TODO
```

### /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa7ffeI9k7IdscC66T2F/results.md
```markdown
# Subagent Results

- Session: ses_3c822ffa7ffeI9k7IdscC66T2F
- Created: 2026-02-07T11:29:16.380Z

## Summary

- Verified engagement artifact directories exist (evidence/, evidence/raw, evidence/processed, reports/).
- Observed current state: evidence/ and reports/ are present but empty (no collected artifacts yet).

## Evidence Links

- Engagement root: /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82
- Directories verified:
  - /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/evidence
  - /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/evidence/raw
  - /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/evidence/processed
  - /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/reports

## Command Provenance

- Non-destructive verification command executed:
  - ROOT="/Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82"; ls -la "$ROOT"; ls -la "$ROOT/evidence"; ls -la "$ROOT/reports"; ls -la "$ROOT/evidence/raw"; ls -la "$ROOT/evidence/processed"
- Observed output (abridged):
  - evidence/ exists with raw/ and processed/ subdirs; all currently empty
  - reports/ exists; currently empty

## Recommended Evidence Inventory File (do not create in this pass)

- Proposed path: /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/evidence/processed/evidence-inventory.md
- Purpose: single-page index of artifacts collected during this smoke test (what, where, how produced), suitable for chain-of-custody.
- Suggested contents outline:
  1. Header
     - Engagement/session ID, date/time (UTC + local), operator, scope note (smoke test; non-destructive)
     - Environment root path
  2. Artifact index table
     - Columns: ID | Artifact | Path | Source command/tool | Timestamp | Notes | Hash (optional)
  3. Commands and logs captured
     - Terminal commands run (or pointer to raw command transcript)
     - Tool versions (bun/node/opencode version), if applicable
  4. Raw evidence
     - evidence/raw/: scanner outputs, HTTP responses, screenshots, packet captures (if any), exported configs
  5. Processed evidence
     - evidence/processed/: normalized excerpts, redactions, parsed summaries, sanitized screenshots
  6. Reports linkage
     - reports/: draft outputs, result summaries, final bundle references
  7. Redaction notes
     - Any PII/student-data handling notes and where redactions were applied
```

### /Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa8ffdiNhG1p0Hz0U8P1/results.md
```markdown
# Subagent Results

- Session: ses_3c822ffa8ffdiNhG1p0Hz0U8P1
- Created: 2026-02-07T11:29:16.380Z

## Summary
- TODO

## Evidence Links
- TODO
```


## Canonical Finding Log
```markdown
# Engagement Findings

- Session: ses_3c8248f12ffeVicLR7Uwq2qdQH
- Started: 2026-02-07T11:27:34.171Z

## Findings

_Append each validated finding below with timestamp, asset, severity, confidence, evidence, impact, and remediation._
### [FND-BWRDYG95XT] Tool permission policy blocks editing engagement artifacts (results/handoff)
- timestamp: 2026-02-07T11:31:11.520Z
- severity: medium
- confidence: 0.9
- asset: opencode cyber session tool permissions
- non_destructive: true

#### Evidence
Attempting to update the required subagent artifact `engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa8ffdiNhG1p0Hz0U8P1/results.md` via `apply_patch` failed with a tool-policy denial:

`Error: The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{"permission":"*","pattern":"*","action":"allow"},{"permission":"edit","pattern":"*","action":"deny"}]`

At the same time, OS-level checks show the files/dirs are writable (e.g., `finding.md: writable`, `handoff.md: writable`, `results.md: writable`).

#### Impact
Cyber workflow audit trail can’t be maintained by subagents (cannot update results.md/handoff.md using the available editing mechanism). This can break engagement compliance requirements, reduce report quality, and prevent coordination updates from being captured in the canonical artifacts.

#### Recommendation
Adjust the runtime/tool permission policy for cyber sessions to allow editing/writing of engagement artifacts (at minimum: `handoff.md`, `agents/*/results.md`, and optionally `reports/*`), or provide a dedicated non-interactive write tool that is permitted for these paths. Ensure the permission layer distinguishes between project code edits vs. engagement-artifact updates.

#### Safe Reproduction Steps
1. In an active cyber session, try to update `engagements/<session>/agents/<subagent>/results.md` using the file edit mechanism (e.g., apply_patch).
2. Observe the policy denial referencing `permission: edit` being globally denied.
3. Confirm the same file is OS-writable (`test -w <path>`), showing it is a tool-policy issue rather than filesystem permissions.

<!-- finding_json:{"id":"FND-BWRDYG95XT","title":"Tool permission policy blocks editing engagement artifacts (results/handoff)","severity":"medium","confidence":0.9,"asset":"opencode cyber session tool permissions","evidence":"Attempting to update the required subagent artifact `engagements/2026-02-07-ses_3c82/agents/ses_3c822ffa8ffdiNhG1p0Hz0U8P1/results.md` via `apply_patch` failed with a tool-policy denial:\n\n`Error: The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{\"permission\":\"*\",\"pattern\":\"*\",\"action\":\"allow\"},{\"permission\":\"edit\",\"pattern\":\"*\",\"action\":\"deny\"}]`\n\nAt the same time, OS-level checks show the files/dirs are writable (e.g., `finding.md: writable`, `handoff.md: writable`, `results.md: writable`).","impact":"Cyber workflow audit trail can’t be maintained by subagents (cannot update results.md/handoff.md using the available editing mechanism). This can break engagement compliance requirements, reduce report quality, and prevent coordination updates from being captured in the canonical artifacts.","recommendation":"Adjust the runtime/tool permission policy for cyber sessions to allow editing/writing of engagement artifacts (at minimum: `handoff.md`, `agents/*/results.md`, and optionally `reports/*`), or provide a dedicated non-interactive write tool that is permitted for these paths. Ensure the permission layer distinguishes between project code edits vs. engagement-artifact updates.","safe_reproduction_steps":["In an active cyber session, try to update `engagements/<session>/agents/<subagent>/results.md` using the file edit mechanism (e.g., apply_patch).","Observe the policy denial referencing `permission: edit` being globally denied.","Confirm the same file is OS-writable (`test -w <path>`), showing it is a tool-policy issue rather than filesystem permissions."],"non_destructive":true,"timestamp":"2026-02-07T11:31:11.520Z"} -->
### [FND-BP7A638K5S] CI workflow executes remote installer via curl|bash
- timestamp: 2026-02-07T11:33:54.785Z
- severity: medium
- confidence: 0.95
- asset: GitHub Actions workflow: .github/workflows/review.yml
- non_destructive: true

#### Evidence
In `/Users/trevorrosato/codeprojects/ULMcode/opencode/.github/workflows/review.yml`, the workflow runs a remote installer script directly:
- Lines 34-35:
  - `- name: Install opencode`
  - `run: curl -fsSL https://opencode.ai/install | bash`
This executes unpinned remote code during CI.

#### Impact
If the install endpoint, DNS/TLS path, or upstream hosting is compromised, an attacker can achieve arbitrary code execution in the CI runner context, potentially impacting build artifacts, secrets available to the job, and repository operations performed by the workflow.

#### Recommendation
Avoid `curl | bash` in CI. Prefer a pinned, integrity-verified install method (e.g., package manager with version pinning, checksum/signature verification, or vendoring the installer script at a pinned commit). If a script must be fetched, pin to an immutable version and verify a published checksum/signature before execution.

#### Safe Reproduction Steps
1. Open `.github/workflows/review.yml`
2. Locate the `Install opencode` step
3. Observe `curl -fsSL https://opencode.ai/install | bash` being executed

<!-- finding_json:{"id":"FND-BP7A638K5S","title":"CI workflow executes remote installer via curl|bash","severity":"medium","confidence":0.95,"asset":"GitHub Actions workflow: .github/workflows/review.yml","evidence":"In `/Users/trevorrosato/codeprojects/ULMcode/opencode/.github/workflows/review.yml`, the workflow runs a remote installer script directly:\n- Lines 34-35:\n  - `- name: Install opencode`\n  - `run: curl -fsSL https://opencode.ai/install | bash`\nThis executes unpinned remote code during CI.","impact":"If the install endpoint, DNS/TLS path, or upstream hosting is compromised, an attacker can achieve arbitrary code execution in the CI runner context, potentially impacting build artifacts, secrets available to the job, and repository operations performed by the workflow.","recommendation":"Avoid `curl | bash` in CI. Prefer a pinned, integrity-verified install method (e.g., package manager with version pinning, checksum/signature verification, or vendoring the installer script at a pinned commit). If a script must be fetched, pin to an immutable version and verify a published checksum/signature before execution.","safe_reproduction_steps":["Open `.github/workflows/review.yml`","Locate the `Install opencode` step","Observe `curl -fsSL https://opencode.ai/install | bash` being executed"],"non_destructive":true,"timestamp":"2026-02-07T11:33:54.785Z"} -->
### [FND-KRX5XQD0QP] CI uses TOFU ssh-keyscan and writes AUR deploy key to disk
- timestamp: 2026-02-07T11:33:54.787Z
- severity: medium
- confidence: 0.9
- asset: GitHub Actions workflow: .github/workflows/publish.yml (AUR publishing)
- non_destructive: true

#### Evidence
In `/Users/trevorrosato/codeprojects/ULMcode/opencode/.github/workflows/publish.yml` the job sets up SSH for AUR by writing the private key to disk and trusting host keys via ssh-keyscan:
- Lines 58-63:
  - `echo "${{ secrets.AUR_KEY }}" > ~/.ssh/id_rsa`
  - `chmod 600 ~/.ssh/id_rsa`
  - `ssh-keyscan -H aur.archlinux.org >> ~/.ssh/known_hosts || true`
This is trust-on-first-use for host keys and persists the private key on the runner filesystem during the job.

#### Impact
A MITM on the CI network path could feed a malicious host key during `ssh-keyscan`, enabling credential capture or malicious pushes to the AUR repo. Writing the deploy key to disk increases the blast radius if the runner is compromised during job execution.

#### Recommendation
Pin the expected AUR host key(s) (commit them in-repo or store as a protected secret) instead of `ssh-keyscan` TOFU. Prefer `ssh-agent` with an ephemeral key file and strict permissions, and consider using `known_hosts` with exact key material. Ensure secrets are least-privilege and job permissions are minimized.

#### Safe Reproduction Steps
1. Open `.github/workflows/publish.yml`
2. Locate the `Setup SSH for AUR` step
3. Observe `echo ... > ~/.ssh/id_rsa` and `ssh-keyscan ... >> known_hosts`

<!-- finding_json:{"id":"FND-KRX5XQD0QP","title":"CI uses TOFU ssh-keyscan and writes AUR deploy key to disk","severity":"medium","confidence":0.9,"asset":"GitHub Actions workflow: .github/workflows/publish.yml (AUR publishing)","evidence":"In `/Users/trevorrosato/codeprojects/ULMcode/opencode/.github/workflows/publish.yml` the job sets up SSH for AUR by writing the private key to disk and trusting host keys via ssh-keyscan:\n- Lines 58-63:\n  - `echo \"${{ secrets.AUR_KEY }}\" > ~/.ssh/id_rsa`\n  - `chmod 600 ~/.ssh/id_rsa`\n  - `ssh-keyscan -H aur.archlinux.org >> ~/.ssh/known_hosts || true`\nThis is trust-on-first-use for host keys and persists the private key on the runner filesystem during the job.","impact":"A MITM on the CI network path could feed a malicious host key during `ssh-keyscan`, enabling credential capture or malicious pushes to the AUR repo. Writing the deploy key to disk increases the blast radius if the runner is compromised during job execution.","recommendation":"Pin the expected AUR host key(s) (commit them in-repo or store as a protected secret) instead of `ssh-keyscan` TOFU. Prefer `ssh-agent` with an ephemeral key file and strict permissions, and consider using `known_hosts` with exact key material. Ensure secrets are least-privilege and job permissions are minimized.","safe_reproduction_steps":["Open `.github/workflows/publish.yml`","Locate the `Setup SSH for AUR` step","Observe `echo ... > ~/.ssh/id_rsa` and `ssh-keyscan ... >> known_hosts`"],"non_destructive":true,"timestamp":"2026-02-07T11:33:54.787Z"} -->
### [FND-8PJK948RGC] Strict-isolation flags not set in current session; external skill directory present
- timestamp: 2026-02-07T11:33:54.807Z
- severity: low
- confidence: 0.75
- asset: Operator runtime environment (local shell running cyber session)
- non_destructive: true

#### Evidence
Environment variables in the current shell did not include the strict-isolation flags (`OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`). Additionally, `$HOME/.agents/skills` exists (though currently empty here), which is a potential external-skill discovery location when isolation flags are not set.
Command evidence collected:
- `printenv | rg '^(OPENCODE|ULMCODE)_'` returned no matches
- `ls -la "$HOME/.agents"` showed `skills/` present

#### Impact
If strict-isolation mode is required for an engagement, running without the isolation flags can allow discovery/loading of skills or config outside the intended allowlist, increasing risk of skill/config leakage or unintended behavior drift between environments.

#### Recommendation
Use the isolated profile launcher (e.g., `tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh`) and run via the generated `ulmcode-launch.sh`, which exports `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and `OPENCODE_DISABLE_PROJECT_CONFIG=1` and pins config via `OPENCODE_CONFIG_DIR/OPENCODE_CONFIG`. Optionally add a startup preflight that fails closed if cyber sessions start without these flags when isolation is expected.

#### Safe Reproduction Steps
1. In a terminal starting a cyber session, run `printenv | rg '^(OPENCODE|ULMCODE)_'`
2. Verify isolation flags are absent
3. Run `ls -la "$HOME/.agents"` to confirm external skill directory exists

<!-- finding_json:{"id":"FND-8PJK948RGC","title":"Strict-isolation flags not set in current session; external skill directory present","severity":"low","confidence":0.75,"asset":"Operator runtime environment (local shell running cyber session)","evidence":"Environment variables in the current shell did not include the strict-isolation flags (`OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`). Additionally, `$HOME/.agents/skills` exists (though currently empty here), which is a potential external-skill discovery location when isolation flags are not set.\nCommand evidence collected:\n- `printenv | rg '^(OPENCODE|ULMCODE)_'` returned no matches\n- `ls -la \"$HOME/.agents\"` showed `skills/` present","impact":"If strict-isolation mode is required for an engagement, running without the isolation flags can allow discovery/loading of skills or config outside the intended allowlist, increasing risk of skill/config leakage or unintended behavior drift between environments.","recommendation":"Use the isolated profile launcher (e.g., `tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh`) and run via the generated `ulmcode-launch.sh`, which exports `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and `OPENCODE_DISABLE_PROJECT_CONFIG=1` and pins config via `OPENCODE_CONFIG_DIR/OPENCODE_CONFIG`. Optionally add a startup preflight that fails closed if cyber sessions start without these flags when isolation is expected.","safe_reproduction_steps":["In a terminal starting a cyber session, run `printenv | rg '^(OPENCODE|ULMCODE)_'`","Verify isolation flags are absent","Run `ls -la \"$HOME/.agents\"` to confirm external skill directory exists"],"non_destructive":true,"timestamp":"2026-02-07T11:33:54.807Z"} -->
```
