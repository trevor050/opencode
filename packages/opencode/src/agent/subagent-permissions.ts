import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 * 2. Edit-family denies from the launching agent, so plan-mode sessions cannot
 *    bypass read-only mode by spawning an edit-capable subagent.
 * 3. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  parentAgentPermission?: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const parentEditDenies =
    input.parentAgentPermission?.filter(
      (rule) =>
        rule.action === "deny" &&
        (rule.permission === "edit" || rule.permission === "write" || rule.permission === "apply_patch"),
    ) ?? []
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...parentEditDenies,
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
