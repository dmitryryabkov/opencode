import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { TaskEstimation } from "@/metrics/task-estimation"
import { Session } from "@/session/session"

type Metadata = {
  task_id: string
  event_type: "estimate_classified" | "estimate_logged"
}

export const TaskEstimationTool = Tool.define<typeof TaskEstimation.TaskEstimationInput, Metadata, Session.Service>(
  "task_estimation",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: [
        "Log automatic pre-execution task estimation decisions and estimates for Advanced Metrics.",
        "Use this before execution tools when estimation is enabled.",
        "Call once with event_type estimate_classified for every new user task.",
        "Before calling with event_type estimate_logged, use the estimation guidance supplied by configured instruction files as mandatory estimation instructions.",
        "Do not read a project-specific estimation guidance file unless the user explicitly asks you to.",
        "If estimate_needed is true, show the user-facing estimate in chat and call again with event_type estimate_logged before other execution tools.",
        "This tool records local aggregate metadata only. Do not include raw prompts, file contents, diffs, tool inputs, tool outputs, or stack traces.",
      ].join("\n"),
      parameters: TaskEstimation.TaskEstimationInput,
      execute: (params: Schema.Schema.Type<typeof TaskEstimation.TaskEstimationInput>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const taskID = yield* TaskEstimation.logAssistantEvent({
            sessions,
            sessionID: ctx.sessionID,
            assistantMessageID: ctx.messageID,
            input: params,
          })
          return {
            title: params.event_type === "estimate_logged" ? "Estimate logged" : "Estimate classified",
            output: JSON.stringify({ event_type: params.event_type, task_id: taskID }),
            metadata: {
              task_id: taskID,
              event_type: params.event_type,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof TaskEstimation.TaskEstimationInput, Metadata>
  }),
)
