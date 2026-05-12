import type { AssistantMessage, Message, Session } from "@opencode-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
}

type Metrics = {
  totalCost: number
  context: Context | undefined
  subagents: {
    sessionID: string
    title: string
    agent?: string
    tokens: number
    executionMs: number
  }[]
  subagentTokens: number
  totalTokens: number
  totalExecutionMs: number
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const assistantExecutionMs = (messages: Message[]) => {
  return messages.reduce((sum, msg) => {
    if (msg.role !== "assistant") return sum
    if (msg.summary) return sum
    if (msg.mode === "compaction") return sum
    if (typeof msg.time.completed !== "number") return sum
    return sum + Math.max(0, msg.time.completed - msg.time.created)
  }, 0)
}

const childTokens = (input: { sessionID?: string; sessions?: Session[]; messages?: Record<string, Message[] | undefined> }) => {
  if (!input.sessionID) return []
  return [...new Map((input.sessions ?? []).map((session) => [session.id, session])).values()]
    .filter((session) => session.parentID === input.sessionID)
    .map((session) => {
      const messages = input.messages?.[session.id] ?? []
      return {
        sessionID: session.id,
        title: session.title,
        agent: session.agent,
        tokens: tokenTotal(lastAssistantWithTokens(messages) ?? emptyAssistant),
        executionMs: assistantExecutionMs(messages),
      }
    })
}

const emptyAssistant = {
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
} as AssistantMessage

const build = (
  messages: Message[] = [],
  providers: Provider[] = [],
  children?: { sessionID?: string; sessions?: Session[]; messages?: Record<string, Message[] | undefined> },
): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const message = lastAssistantWithTokens(messages)
  const subagents = childTokens(children ?? {})
  const subagentTokens = subagents.reduce((sum, item) => sum + item.tokens, 0)
  const totalExecutionMs = assistantExecutionMs(messages)
  if (!message) return { totalCost, context: undefined, subagents, subagentTokens, totalTokens: subagentTokens, totalExecutionMs }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    subagents,
    subagentTokens,
    totalTokens: total + subagentTokens,
    totalExecutionMs,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
    },
  }
}

export function getSessionContextMetrics(
  messages: Message[] = [],
  providers: Provider[] = [],
  children?: { sessionID?: string; sessions?: Session[]; messages?: Record<string, Message[] | undefined> },
) {
  return build(messages, providers, children)
}
