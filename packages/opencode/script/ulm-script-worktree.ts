import fs from "fs"
import path from "path"

export function resolveScriptWorktree(input?: string) {
  if (input) return path.resolve(input)

  let firstUlmcode: string | undefined
  for (let current = process.cwd(); ; current = path.dirname(current)) {
    if (!firstUlmcode && fs.existsSync(path.join(current, ".ulmcode"))) firstUlmcode = current
    if (fs.existsSync(path.join(current, ".git"))) return current
    const parent = path.dirname(current)
    if (parent === current) return firstUlmcode ?? process.cwd()
  }
}
