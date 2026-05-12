import fs from "fs/promises"
import path from "path"
import { Effect, Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Instance } from "@/project/instance"
import { buildCommandPlan, writeCommandPlan } from "@/ulm/tool-manifest"
import { containsRawCredentialSecret, credentialGuessingPolicyGaps } from "@/ulm/credential-safety"
import { assertLaneToolAllowed } from "@/ulm/lane-tool-guard"
import { errorMessage } from "@/util/error"
import * as Tool from "./tool"
import DESCRIPTION from "./command_supervise.txt"

const Variables = Schema.Record(Schema.String, Schema.String)

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  laneID: Schema.optional(Schema.String),
  workUnitID: Schema.optional(Schema.String).annotate({
    description: "Optional operation_queue work unit ID so operation_run can sync command completion back to the queue.",
  }),
  profileID: Schema.String.annotate({
    description: "Command profile ID from tools/ulmcode-profile/tool-manifest.json, for example service-inventory.",
  }),
  variables: Schema.optional(Variables).annotate({
    description: "Template variables such as target, url, inputFile, wordlist, and outputPrefix.",
  }),
  outputPrefix: Schema.optional(Schema.String).annotate({
    description: "Optional output prefix relative to the operation root, usually evidence/raw/<name>.",
  }),
  manifestPath: Schema.optional(Schema.String).annotate({
    description: "Optional explicit manifest path. Defaults to tools/ulmcode-profile/tool-manifest.json in the worktree.",
  }),
  worktree: Schema.optional(Schema.String).annotate({
    description: "Optional worktree override used by recovery flows. Defaults to the current instance worktree.",
  }),
  dryRun: Schema.optional(Schema.Boolean).annotate({
    description: "When true, only write the command plan and do not launch the background job. Defaults to true.",
  }),
})

type Metadata = {
  operationID: string
  laneID?: string
  workUnitID?: string
  profileID: string
  command: string
  variables?: Record<string, string>
  outputPrefix?: string
  manifestPath?: string
  worktree?: string
  planPath: string
  stdoutPath: string
  stderrPath: string
  heartbeatPath: string
  jobID?: string
  dryRun: boolean
}

function toolPromise<T>(try_: () => Promise<T>) {
  return Effect.tryPromise({
    try: try_,
    catch: (error) => new Error(errorMessage(error)),
  })
}

function normalized(value: unknown) {
  return JSON.stringify(value ?? {}, Object.keys((value && typeof value === "object" ? value : {}) as Record<string, unknown>).sort())
}

function duplicateCommandJob(
  jobs: BackgroundJob.Info[],
  input: { operationID: string; laneID?: string; profileID: string; variables?: Record<string, string>; outputPrefix?: string },
) {
  const inputVariables = normalized(input.variables)
  return jobs.find((job) => {
    const metadata = job.metadata ?? {}
    if (job.type !== "command_supervise") return false
    if (job.status !== "running" && job.status !== "stale") return false
    if (metadata.operationID !== input.operationID) return false
    if ((metadata.laneID ?? undefined) !== (input.laneID ?? undefined)) return false
    if (metadata.profileID !== input.profileID) return false
    if ((metadata.outputPrefix ?? undefined) !== (input.outputPrefix ?? undefined)) return false
    return normalized(metadata.variables) === inputVariables
  })
}

async function runCommand(input: {
  command: string
  cwd: string
  stdoutPath: string
  stderrPath: string
  heartbeatPath: string
  heartbeatSeconds: number
  idleTimeoutSeconds: number
  hardTimeoutSeconds: number
}) {
  await fs.mkdir(path.dirname(input.stdoutPath), { recursive: true })
  await fs.writeFile(input.stdoutPath, "")
  await fs.writeFile(input.stderrPath, "")
  await fs.writeFile(
    input.heartbeatPath,
    JSON.stringify({ status: "running", startedAt: new Date().toISOString(), lastOutputAt: null }, null, 2) + "\n",
  )
  const proc = Bun.spawn(["bash", "-lc", input.command], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  let lastOutputAt = Date.now()
  let timedOut: "hard" | "idle" | undefined

  const writeHeartbeat = async (status = "running") => {
    await fs.writeFile(
      input.heartbeatPath,
      JSON.stringify(
        {
          status,
          command: input.command,
          lastOutputAt: new Date(lastOutputAt).toISOString(),
          checkedAt: new Date().toISOString(),
          idleSeconds: Math.round((Date.now() - lastOutputAt) / 1000),
          timedOut,
        },
        null,
        2,
      ) + "\n",
    )
  }

  const hardTimeout = setTimeout(() => {
    timedOut = "hard"
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 5_000).unref()
  }, input.hardTimeoutSeconds * 1000)
  hardTimeout.unref()
  const heartbeat = setInterval(() => {
    if (Date.now() - lastOutputAt > input.idleTimeoutSeconds * 1000) {
      timedOut = "idle"
      proc.kill("SIGTERM")
      setTimeout(() => proc.kill("SIGKILL"), 5_000).unref()
    }
    void writeHeartbeat()
  }, input.heartbeatSeconds * 1000)
  heartbeat.unref()

  async function drain(stream: ReadableStream<Uint8Array> | null, file: string) {
    if (!stream) return ""
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    let text = ""
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const part = decoder.decode(chunk.value, { stream: true })
      text += part
      lastOutputAt = Date.now()
      await fs.appendFile(file, part)
    }
    const tail = decoder.decode()
    if (tail) {
      text += tail
      lastOutputAt = Date.now()
      await fs.appendFile(file, tail)
    }
    return text
  }

  const [, stderrText, exitCode] = await Promise.all([
    drain(proc.stdout, input.stdoutPath),
    drain(proc.stderr, input.stderrPath),
    proc.exited,
  ])
  clearTimeout(hardTimeout)
  clearInterval(heartbeat)
  await writeHeartbeat(exitCode === 0 && !timedOut ? "completed" : "error")
  if (timedOut) throw new Error(`command ${timedOut} timeout after ${timedOut === "hard" ? input.hardTimeoutSeconds : input.idleTimeoutSeconds}s`)
  if (exitCode !== 0) throw new Error(`command exited ${exitCode}; stderr: ${stderrText.slice(0, 2000)}`)
  return [
    `command: ${input.command}`,
    `exit_code: ${exitCode}`,
    `stdout: ${input.stdoutPath}`,
    `stderr: ${input.stderrPath}`,
    `heartbeat: ${input.heartbeatPath}`,
  ].join("\n")
}

export const CommandSuperviseTool = Tool.define<typeof Parameters, Metadata, BackgroundJob.Service>(
  "command_supervise",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
        Effect.gen(function* () {
          assertLaneToolAllowed("command_supervise")
          if (
            containsRawCredentialSecret({
              operationID: params.operationID,
              profileID: params.profileID,
              variables: params.variables,
              outputPrefix: params.outputPrefix,
            })
          ) {
            return yield* Effect.die(new Error("supervised command inputs must not contain raw credential secrets"))
          }
          const guessingGaps = credentialGuessingPolicyGaps({
            profileID: params.profileID,
            variables: params.variables,
            outputPrefix: params.outputPrefix,
          })
          if (guessingGaps.length) return yield* Effect.die(new Error(guessingGaps.join("; ")))
          const dryRun = params.dryRun ?? true
          const plan = yield* toolPromise(() =>
            buildCommandPlan({
              worktree: params.worktree ?? Instance.worktree,
              operationID: params.operationID,
              profileID: params.profileID,
              variables: params.variables,
              outputPrefix: params.outputPrefix,
              manifestPath: params.manifestPath,
              dryRun,
            }),
          ).pipe(Effect.orDie)
          yield* toolPromise(() => writeCommandPlan(plan)).pipe(Effect.orDie)

          let jobID: string | undefined
          let duplicate: BackgroundJob.Info | undefined
          if (!dryRun && ctx.extra?.recoverExistingOperationJob !== true) {
            duplicate = duplicateCommandJob(yield* jobs.list(), {
              operationID: plan.operationID,
              laneID: params.laneID,
              profileID: plan.profile.id,
              variables: params.variables,
              outputPrefix: params.outputPrefix,
            })
            if (duplicate) jobID = duplicate.id
          }
          if (!dryRun && !duplicate) {
            const job = yield* jobs.start({
              type: "command_supervise",
              title: `${plan.profile.id}: ${plan.profile.tool}`,
              metadata: {
                operationID: plan.operationID,
                ...(params.laneID ? { laneID: params.laneID } : {}),
                ...(params.workUnitID ? { workUnitID: params.workUnitID } : {}),
                profileID: plan.profile.id,
                tool: plan.profile.tool,
                command: plan.command,
                variables: params.variables,
                outputPrefix: params.outputPrefix,
                ...(params.manifestPath ? { manifestPath: params.manifestPath } : {}),
                supervision: plan.supervision,
                planPath: plan.planPath,
                stdoutPath: plan.stdoutPath,
                stderrPath: plan.stderrPath,
                heartbeatPath: plan.heartbeatPath,
                restartable: plan.profile.restartable,
                worktree: params.worktree ?? Instance.worktree,
              },
              run: toolPromise(() =>
                runCommand({
                  command: plan.command,
                  cwd: plan.operationRoot,
                  stdoutPath: plan.stdoutPath,
                  stderrPath: plan.stderrPath,
                  heartbeatPath: plan.heartbeatPath,
                  heartbeatSeconds: plan.supervision.heartbeatSeconds,
                  idleTimeoutSeconds: plan.supervision.idleTimeoutSeconds,
                  hardTimeoutSeconds: plan.supervision.hardTimeoutSeconds,
                }),
              ),
            })
            jobID = job.id
          }

          return {
            title: dryRun ? `Planned ${plan.profile.id}` : `Launched ${plan.profile.id}`,
            output: [
              `operation_id: ${plan.operationID}`,
              ...(params.laneID ? [`lane_id: ${params.laneID}`] : []),
              ...(params.workUnitID ? [`work_unit_id: ${params.workUnitID}`] : []),
              `profile_id: ${plan.profile.id}`,
              `tool: ${plan.profile.tool}`,
              `dry_run: ${dryRun}`,
              ...(duplicate ? ["deduped: true", `existing_job_id: ${duplicate.id}`] : []),
              ...(jobID ? [`job_id: ${jobID}`] : []),
              `plan: ${plan.planPath}`,
              `stdout: ${plan.stdoutPath}`,
              `stderr: ${plan.stderrPath}`,
              `heartbeat: ${plan.heartbeatPath}`,
              "",
              plan.command,
            ].join("\n"),
            metadata: {
              operationID: plan.operationID,
              laneID: params.laneID,
              workUnitID: params.workUnitID,
              profileID: plan.profile.id,
              command: plan.command,
              variables: params.variables,
              outputPrefix: params.outputPrefix,
              manifestPath: params.manifestPath,
              worktree: params.worktree,
              planPath: plan.planPath,
              stdoutPath: plan.stdoutPath,
              stderrPath: plan.stderrPath,
              heartbeatPath: plan.heartbeatPath,
              jobID,
              dryRun,
            },
          }
        }),
    }
  }),
)
