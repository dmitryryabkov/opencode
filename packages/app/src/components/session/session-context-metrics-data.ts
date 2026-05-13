import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"

type Client = {
  session: {
    messages(input: { sessionID: string }): Promise<{ data?: { info: Message }[] }>
  }
}

export async function loadSessionContextMessages(input: {
  client: Client
  sessionID?: string
  childSessions?: Session[]
}) {
  return Object.fromEntries(
    await Promise.all(
      [...new Set([input.sessionID, ...(input.childSessions ?? []).map((session) => session.id)])]
        .filter((sessionID): sessionID is string => !!sessionID)
        .map(async (sessionID) => {
          const response = await input.client.session.messages({ sessionID })
          return [sessionID, (response.data ?? []).map((message) => message.info)] as const
        }),
    ),
  )
}

export function sessionContextHistoryInput(input: {
  sessionID?: string
  childSessions?: Session[]
  messages: Record<string, Message[] | undefined>
  statuses: Record<string, SessionStatus | undefined>
}) {
  if (!input.sessionID) return

  const childSessions = input.childSessions ?? []
  const sessionIDs = [input.sessionID, ...childSessions.map((session) => session.id)]
  if (sessionIDs.some((sessionID) => input.statuses[sessionID] && input.statuses[sessionID]?.type !== "idle")) return
  if (!sessionIDs.some((sessionID) => input.messages[sessionID]?.some((message) => message.role === "assistant")))
    return

  return {
    sessionID: input.sessionID,
    childSessions,
  }
}
