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
