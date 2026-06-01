import { Resource } from "@opencode-ai/console-resource"
import { getRedis } from "./redis"

// Workspaces whose balance/usage updates should be batched in Redis to avoid
// row-level lock contention on BillingTable / UserTable.
export const HOT_WORKSPACES = new Set<string>([
  "wrk_01KJ8PX5CH50Y4YNGNS9ZR8YDC", // invoice
])

const USAGE_KEY_TTL_SECONDS = 24 * 60 * 60

// Flush every request until a background stale-key flusher exists. Leaving this
// probabilistic can strand inactive users' final usage in Redis indefinitely.
const FLUSH_PROBABILITY = 1

export async function accumulateUsage(workspaceID: string, userID: string, workspaceCost: number, userCost: number) {
  const redis = getRedis()
  const wKey = `${Resource.App.stage}:usage:wrk:${workspaceID}`
  const uKey = `${Resource.App.stage}:usage:usr:${workspaceID}:${userID}`

  const pipeline = redis.pipeline()
  pipeline.incrby(wKey, workspaceCost)
  pipeline.expire(wKey, USAGE_KEY_TTL_SECONDS)
  pipeline.incrby(uKey, userCost)
  pipeline.expire(uKey, USAGE_KEY_TTL_SECONDS)
  await pipeline.exec()

  if (Math.random() > FLUSH_PROBABILITY) return null

  // Atomically take the current totals and reset to 0
  const [workspaceTotal, userTotal] = await Promise.all([redis.getdel<number>(wKey), redis.getdel<number>(uKey)])

  const workspaceFlush = Number(workspaceTotal ?? 0)
  const userFlush = Number(userTotal ?? 0)
  if (workspaceFlush === 0 && userFlush === 0) return null

  return { workspaceCost: workspaceFlush, userCost: userFlush }
}
