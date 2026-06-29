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

type Input = {
  sessionID?: string
  sessions?: Session[]
  messages?: Record<string, Message[] | undefined>
  histories?: Record<string, Message[] | undefined>
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
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
  return mergeMessages(input?.histories?.[sessionID], input?.messages?.[sessionID])
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
      title: session.title,
      agent: session.agent,
      tokens: sessionTokens(messages),
      executionMs: assistantExecutionMs(messages),
    }
  })
}

const buildContext = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
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
  }
}

const build = (messages: Message[] = [], providers: Provider[] = [], children?: Input): Metrics => {
  const rootMessages = children?.sessionID
    ? mergeMessages(children.histories?.[children.sessionID], children.messages?.[children.sessionID] ?? messages)
    : messages
  const subagents = childTokens(children ?? {})
  const subagentTokens = subagents.reduce((sum, item) => sum + item.tokens, 0)
  const subagentCost = childSessions(children ?? {}).reduce(
    (sum, session) => sum + sessionCost(inputMessages(children, session.id)),
    0,
  )
  return {
    totalCost: sessionCost(rootMessages) + subagentCost,
    context: buildContext(messages, providers),
    subagents,
    subagentTokens,
    totalTokens: sessionTokens(rootMessages) + subagentTokens,
    totalExecutionMs: assistantExecutionMs(rootMessages),
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return buildContext(messages, providers)
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = [], children?: Input) {
  return build(messages, providers, children)
}

export function getSessionTokenTotal(tokens: Session["tokens"] | undefined) {
  if (!tokens) return undefined
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}
