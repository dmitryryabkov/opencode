import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

const ESTIMATION_INSTRUCTIONS = [
  "## Automatic Task Estimates",
  "",
  "Before code-editing tools, shell commands, subagent calls, live API calls, builds, tests, installs, migrations, or other execution actions for each new user task, decide whether a task estimate is needed.",
  "Before logging any estimate_logged event, use the estimation guidance supplied by configured instruction files as mandatory estimation instructions. Do not read a project-specific estimation guidance file unless the user explicitly asks you to.",
  "Use the task_estimation tool to log an estimate_classified event before execution. If an estimate is needed, show the estimate in chat, then log estimate_logged before any other execution tool use. Continue automatically after showing the estimate; do not wait for confirmation.",
  "Require an estimate when the task is moderate or complex, likely touches multiple files, involves verification commands, combines backend plus frontend work, changes APIs/config/schema/prompts, likely uses a subagent, needs live API calls/builds/tests/migrations/dependency installs, is expected to take over 5 minutes, is expected to need over 10 assistant/model calls, or the user explicitly asks for an estimate.",
  "Skip the structured estimate only for tiny focused edits in known files or small areas with minimal ambiguity, no expected subagent use, no build/test suite/migration/install/live API call, at most inspection or a very quick focused command, expected wall-clock time of 5 minutes or less, expected assistant/model calls of 10 or fewer, and no explicit user estimate request. When skipped, log only estimate_classified and do not mention the skip in chat.",
  "Use task classes tiny_focused_edit, small_implementation, moderate_implementation, or complex_integration. If uncertain, choose estimate_needed true.",
  "Use this user-facing estimate format when an estimate is needed:",
  "Task class: tiny / small / moderate / complex",
  "",
  "Wall-clock: X-Y minutes",
  "Assistant turns/model calls: X-Y",
  "Tool cycles: X-Y",
  "Fresh tokens: X-Y",
  "Cache-read-inclusive tokens: X-Y, if cached context is reused",
  "",
  "Assumes:",
  "- subagents: none / N",
  "- verification: none / focused test / typecheck / full test suite / build / manual check",
  "- slow commands: none / list",
  "",
  "Main uncertainty:",
  "The biggest unknown that could materially change this estimate.",
  "",
  "Do not include raw prompt text, tool inputs, tool outputs, file contents, diffs, or stack traces in task_estimation payloads.",
].join("\n")

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
            ESTIMATION_INSTRUCTIONS,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
