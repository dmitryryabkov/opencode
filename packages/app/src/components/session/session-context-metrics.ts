import type { AssistantMessage, Message, Part, Session } from "@opencode-ai/sdk/v2/client"

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
  estimatedCost: (pricing: EstimatedCostPricing | undefined) => number | undefined
  context: Context | undefined
  usage: UsageTotals
  toolCycles: number
  subagents: {
    sessionID: string
    parentSessionID: string
    title: string
    agent?: string
    depth: number
    tokens: number
    executionMs: number
  }[]
  subagentTokens: number
  totalTokens: number
  totalExecutionMs: number
}

export type UsageTotals = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  fresh: number
  cacheInclusive: number
}

export type EstimatedCostPricing = {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

type Input = {
  sessionID?: string
  sessions?: Session[]
  messages?: Record<string, Message[] | undefined>
  parts?: Record<string, Part[] | undefined>
  histories?: Record<string, SessionHistory | Message[] | undefined>
}

export type SessionHistory = {
  messages: Message[]
  parts?: Record<string, Part[] | undefined>
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const emptyUsage = (): UsageTotals => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  fresh: 0,
  cacheInclusive: 0,
})

const addUsage = (target: UsageTotals, next: UsageTotals) => {
  target.input += next.input
  target.output += next.output
  target.reasoning += next.reasoning
  target.cacheRead += next.cacheRead
  target.cacheWrite += next.cacheWrite
  target.fresh += next.fresh
  target.cacheInclusive += next.cacheInclusive
  return target
}

const messageUsage = (messages: Message[]) => {
  return messages.reduce((sum, msg) => {
    if (msg.role !== "assistant") return sum
    const usage = {
      input: msg.tokens.input,
      output: msg.tokens.output,
      reasoning: msg.tokens.reasoning,
      cacheRead: msg.tokens.cache.read,
      cacheWrite: msg.tokens.cache.write,
      fresh: msg.tokens.input + msg.tokens.output + msg.tokens.reasoning,
      cacheInclusive: tokenTotal(msg),
    }
    return addUsage(sum, usage)
  }, emptyUsage())
}

const historyMessages = (history: SessionHistory | Message[] | undefined) => {
  return Array.isArray(history) ? history : history?.messages
}

const historyParts = (history: SessionHistory | Message[] | undefined) => {
  return Array.isArray(history) ? undefined : history?.parts
}

const hasToolPart = (message: Message, parts: Record<string, Part[] | undefined> | undefined) => {
  if (message.role !== "assistant") return false
  if (message.summary || message.mode === "compaction") return false
  return parts?.[message.id]?.some((part) => part.type === "tool") ?? false
}

const toolCycles = (messages: Message[], parts: Record<string, Part[] | undefined> | undefined) => {
  return messages.reduce((sum, message) => sum + (hasToolPart(message, parts) ? 1 : 0), 0)
}

const isCompaction = (msg: AssistantMessage) => {
  return msg.summary === true || msg.mode === "compaction"
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

const lastContextBeforeCompaction = (messages: Message[], compaction: AssistantMessage) => {
  const index = messages.findIndex((message) => message.id === compaction.parentID)
  const last = messages
    .slice(0, index < 0 ? messages.length : index)
    .findLast((message): message is AssistantMessage => message.role === "assistant" && tokenTotal(message) > 0)
  return last ? tokenTotal(last) : 0
}

const compactionTokens = (messages: Message[]) => {
  return messages.reduce((sum, message) => {
    if (message.role !== "assistant") return sum
    if (!isCompaction(message)) return sum
    if (tokenTotal(message) <= 0) return sum
    return sum + tokenTotal(message) + lastContextBeforeCompaction(messages, message)
  }, 0)
}

const sessionTokens = (messages: Message[]) => {
  const message = lastAssistantWithTokens(messages)
  return (
    (message ? tokenTotal(message) : 0) -
    (message && isCompaction(message) ? tokenTotal(message) : 0) +
    compactionTokens(messages)
  )
}

const sessionCost = (messages: Message[]) => {
  return messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
}

const validPrice = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function estimateContextCost(usage: UsageTotals, pricing: EstimatedCostPricing | undefined) {
  if (!pricing) return undefined
  if (!validPrice(pricing.input) || !validPrice(pricing.output) || !validPrice(pricing.cache_read)) return undefined

  // Message token accounting already separates fresh input from cache read/write tokens.
  const cacheWrite = validPrice(pricing.cache_write) ? pricing.cache_write : 0
  return usage.input * pricing.input + usage.output * pricing.output + usage.cacheRead * pricing.cache_read + usage.cacheWrite * cacheWrite
}

const mergeMessages = (history: Message[] | undefined, live: Message[] | undefined) => {
  if (!history?.length) return live ?? []
  if (!live?.length) return history
  const liveByID = new Map(live.map((message) => [message.id, message]))
  const historyIDs = new Set(history.map((message) => message.id))
  return [
    ...history.map((message) => liveByID.get(message.id) ?? message),
    ...live.filter((message) => !historyIDs.has(message.id)),
  ]
}

const inputMessages = (input: Input | undefined, sessionID: string) => {
  return mergeMessages(historyMessages(input?.histories?.[sessionID]), input?.messages?.[sessionID])
}

const inputParts = (input: Input | undefined, sessionID: string) => {
  return { ...historyParts(input?.histories?.[sessionID]), ...input?.parts }
}

const childSessions = (input: Input) => {
  if (!input.sessionID) return []
  return [...new Map((input.sessions ?? []).map((session) => [session.id, session])).values()].filter(
    (session) => session.parentID === input.sessionID,
  )
}

const childTokens = (input: Input) => {
  return childSessions(input).map((session) => {
    const messages = inputMessages(input, session.id)
    return {
      sessionID: session.id,
      parentSessionID: input.sessionID!,
      title: session.title,
      agent: session.agent,
      depth: 1,
      tokens: sessionTokens(messages),
      executionMs: assistantExecutionMs(messages),
    }
  })
}

const build = (messages: Message[] = [], providers: Provider[] = [], children?: Input): Metrics => {
  const rootMessages = children?.sessionID
    ? mergeMessages(historyMessages(children.histories?.[children.sessionID]), children.messages?.[children.sessionID] ?? messages)
    : messages
  const message = lastAssistantWithTokens(messages)
  const subagents = childTokens(children ?? {})
  const subagentTokens = subagents.reduce((sum, item) => sum + item.tokens, 0)
  const subagentUsage = childSessions(children ?? {}).reduce(
    (sum, session) => addUsage(sum, messageUsage(inputMessages(children, session.id))),
    emptyUsage(),
  )
  const subagentCost = childSessions(children ?? {}).reduce(
    (sum, session) => sum + sessionCost(inputMessages(children, session.id)),
    0,
  )
  const totalCost = sessionCost(rootMessages) + subagentCost
  const totalExecutionMs = assistantExecutionMs(rootMessages)
  const totalTokens = sessionTokens(rootMessages) + subagentTokens
  const usage = addUsage(messageUsage(rootMessages), subagentUsage)
  const rootToolCycles = toolCycles(rootMessages, inputParts(children, children?.sessionID ?? ""))
  const subagentToolCycles = childSessions(children ?? {}).reduce(
    (sum, session) => sum + toolCycles(inputMessages(children, session.id), inputParts(children, session.id)),
    0,
  )
  const totalToolCycles = rootToolCycles + subagentToolCycles
  const estimatedCost = (pricing: EstimatedCostPricing | undefined) => estimateContextCost(usage, pricing)
  if (!message)
    return {
      totalCost,
      estimatedCost,
      context: undefined,
      usage,
      toolCycles: totalToolCycles,
      subagents,
      subagentTokens,
      totalTokens,
      totalExecutionMs,
    }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    estimatedCost,
    usage,
    toolCycles: totalToolCycles,
    subagents,
    subagentTokens,
    totalTokens,
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

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = [], children?: Input) {
  return build(messages, providers, children)
}
