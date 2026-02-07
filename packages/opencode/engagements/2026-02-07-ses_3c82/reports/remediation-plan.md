# Remediation Plan

## Primary Objective
Address highest-risk finding first: [FND-BP7A638K5S] CI workflow executes remote installer via curl|bash (medium).

## 30/60/90 Plan
### 0-30 Days
### 31-60 Days
- FND-BP7A638K5S: Avoid `curl | bash` in CI. Prefer a pinned, integrity-verified install method (e.g., package manager with version pinning, checksum/signature verification, or vendoring the installer script at a pinned commit). If a script must be fetched, pin to an immutable version and verify a published checksum/signature before execution.
- FND-BWRDYG95XT: Adjust the runtime/tool permission policy for cyber sessions to allow editing/writing of engagement artifacts (at minimum: `handoff.md`, `agents/*/results.md`, and optionally `reports/*`), or provide a dedicated non-interactive write tool that is permitted for these paths. Ensure the permission layer distinguishes between project code edits vs. engagement-artifact updates.
- FND-KRX5XQD0QP: Pin the expected AUR host key(s) (commit them in-repo or store as a protected secret) instead of `ssh-keyscan` TOFU. Prefer `ssh-agent` with an ephemeral key file and strict permissions, and consider using `known_hosts` with exact key material. Ensure secrets are least-privilege and job permissions are minimized.
### 61-90 Days
- FND-8PJK948RGC: Use the isolated profile launcher (e.g., `tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh`) and run via the generated `ulmcode-launch.sh`, which exports `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and `OPENCODE_DISABLE_PROJECT_CONFIG=1` and pins config via `OPENCODE_CONFIG_DIR/OPENCODE_CONFIG`. Optionally add a startup preflight that fails closed if cyber sessions start without these flags when isolation is expected.

## Validation Gates
- Re-test all critical/high findings after remediation implementation.
- Confirm detection coverage and incident response telemetry for exploitation paths.
- Update risk register with accepted residual risk and ownership.
