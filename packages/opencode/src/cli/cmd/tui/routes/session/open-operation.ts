import { operationPath, operationsRoot } from "@/ulm/artifact"
import { operationForSession } from "@/ulm/operation-context"
import type { SessionID } from "@/session/schema"

export async function resolveOpenOperationPath(input: {
  worktree?: string
  directory?: string
  sessionID?: SessionID
}) {
  const roots = [input.worktree, input.directory, process.cwd()].filter(
    (item, index, items): item is string => !!item && items.indexOf(item) === index,
  )

  if (input.sessionID) {
    for (const root of roots) {
      const operation = await operationForSession(root, input.sessionID)
      if (operation) return operationPath(operation.worktree, operation.operationID)
    }
  }

  return operationsRoot(roots[0] ?? process.cwd())
}
