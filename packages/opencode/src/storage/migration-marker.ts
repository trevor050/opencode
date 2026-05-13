type Exists = (path: string) => boolean | Promise<boolean>

export async function shouldRunJsonMigration(input: { databasePath: string; exists: Exists }) {
  if (input.databasePath === ":memory:") return false
  return !(await input.exists(input.databasePath))
}
