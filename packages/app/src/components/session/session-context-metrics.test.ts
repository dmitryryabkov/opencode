import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { getSessionContextMetrics } from "./session-context-metrics"
import { sessionContextHistoryInput } from "./session-context-metrics-data"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
  time = { created: 1, completed: 1 },
  extra: Partial<AssistantMessage> = {},
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time,
    ...extra,
  } as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

const session = (id: string, parentID?: string) => {
  return { id, parentID } as Session
}

const busy = { type: "busy" } as SessionStatus

describe("getSessionContextMetrics", () => {
  test("computes totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.totalCost).toBe(1.75)
    expect(metrics.context?.message.id).toBe("a2")
    expect(metrics.context?.total).toBe(500)
    expect(metrics.context?.usage).toBe(50)
    expect(metrics.context?.providerLabel).toBe("OpenAI")
    expect(metrics.context?.modelLabel).toBe("GPT-4.1")
    expect(metrics.subagentTokens).toBe(0)
    expect(metrics.totalTokens).toBe(500)
    expect(metrics.totalExecutionMs).toBe(0)
  })

  test("adds latest child session assistant tokens to total tokens", () => {
    const metrics = getSessionContextMetrics(
      [
        assistant("parent", { input: 100, output: 50, reasoning: 0, read: 0, write: 0 }, 0.5, "openai", "gpt-4.1", {
          created: 1_000,
          completed: 4_000,
        }),
      ],
      [{ id: "openai", models: {} }],
      {
        sessionID: "ses_parent",
        sessions: [session("ses_parent"), session("ses_child_1", "ses_parent"), session("ses_child_2", "ses_parent")],
        messages: {
          ses_child_1: [
            assistant("child_1_old", { input: 10, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1),
            assistant(
              "child_1_new",
              { input: 20, output: 10, reasoning: 5, read: 5, write: 0 },
              0.1,
              "openai",
              "gpt-4.1",
              { created: 5_000, completed: 11_000 },
            ),
          ],
          ses_child_2: [
            assistant("child_2", { input: 5, output: 5, reasoning: 5, read: 0, write: 0 }, 0.1, "openai", "gpt-4.1", {
              created: 20_000,
              completed: 23_000,
            }),
          ],
        },
      },
    )

    expect(metrics.context?.total).toBe(150)
    expect(metrics.subagents).toHaveLength(2)
    expect(metrics.subagents[0]?.sessionID).toBe("ses_child_1")
    expect(metrics.subagents[0]?.tokens).toBe(40)
    expect(metrics.subagents[0]?.executionMs).toBe(6000)
    expect(metrics.subagents[1]?.tokens).toBe(15)
    expect(metrics.subagents[1]?.executionMs).toBe(3000)
    expect(metrics.subagentTokens).toBe(55)
    expect(metrics.totalTokens).toBe(205)
    expect(metrics.totalCost).toBe(0.8)
    expect(metrics.totalExecutionMs).toBe(3000)
  })

  test("uses full histories for compacted parent tokens and cost", () => {
    const visible = [
      assistant("current", { input: 15, output: 5, reasoning: 0, read: 0, write: 0 }, 2, "openai", "gpt-4.1", {
        created: 7_000,
        completed: 9_000,
      }),
    ]
    const history = [
      user("u1"),
      assistant("before_compaction", { input: 80, output: 20, reasoning: 0, read: 0, write: 0 }, 1),
      user("compact"),
      assistant(
        "compaction",
        { input: 10, output: 5, reasoning: 0, read: 0, write: 0 },
        0.2,
        "openai",
        "gpt-4.1",
        { created: 5_000, completed: 6_000 },
        { mode: "compaction", summary: true, parentID: "compact" },
      ),
    ]

    const metrics = getSessionContextMetrics(visible, [{ id: "openai", models: {} }], {
      sessionID: "ses_parent",
      sessions: [session("ses_parent")],
      histories: { ses_parent: history },
    })

    expect(metrics.context?.total).toBe(20)
    expect(metrics.totalTokens).toBe(135)
    expect(metrics.totalCost).toBe(3.2)
    expect(metrics.totalExecutionMs).toBe(2000)
  })

  test("adds child compaction tokens and child costs to totals", () => {
    const parent = [
      assistant("parent", { input: 100, output: 50, reasoning: 0, read: 0, write: 0 }, 0.5, "openai", "gpt-4.1", {
        created: 1_000,
        completed: 4_000,
      }),
    ]
    const child = [
      assistant("child_before", { input: 80, output: 20, reasoning: 0, read: 0, write: 0 }, 1),
      user("child_compact"),
      assistant(
        "child_compaction",
        { input: 10, output: 5, reasoning: 0, read: 0, write: 0 },
        0.2,
        "openai",
        "gpt-4.1",
        { created: 5_000, completed: 6_000 },
        { mode: "compaction", summary: true, parentID: "child_compact" },
      ),
    ]
    const childCurrent = assistant(
      "child_current",
      { input: 15, output: 5, reasoning: 0, read: 0, write: 0 },
      2,
      "openai",
      "gpt-4.1",
      {
        created: 7_000,
        completed: 9_000,
      },
    )

    const metrics = getSessionContextMetrics(parent, [{ id: "openai", models: {} }], {
      sessionID: "ses_parent",
      sessions: [session("ses_parent"), session("ses_child", "ses_parent"), session("ses_child", "ses_parent")],
      messages: {
        ses_child: [childCurrent],
      },
      histories: {
        ses_parent: parent,
        ses_child: child,
      },
    })

    expect(metrics.context?.total).toBe(150)
    expect(metrics.subagents).toHaveLength(1)
    expect(metrics.subagents[0]?.tokens).toBe(135)
    expect(metrics.subagentTokens).toBe(135)
    expect(metrics.totalTokens).toBe(285)
    expect(metrics.totalCost).toBe(3.7)
  })

  test("keeps subagent totals when parent has no assistant tokens", () => {
    const metrics = getSessionContextMetrics([user("u1")], [], {
      sessionID: "ses_parent",
      sessions: [session("ses_child", "ses_parent")],
      messages: {
        ses_child: [assistant("child", { input: 30, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1)],
      },
    })

    expect(metrics.context).toBeUndefined()
    expect(metrics.subagents).toHaveLength(1)
    expect(metrics.subagentTokens).toBe(40)
    expect(metrics.totalTokens).toBe(40)
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.providerLabel).toBe("p-1")
    expect(metrics.context?.modelLabel).toBe("m-1")
    expect(metrics.context?.limit).toBeUndefined()
    expect(metrics.context?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContextMetrics(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContextMetrics(messages, providers)

    expect(one.context?.message.id).toBe("a1")
    expect(two.context?.message.id).toBe("a2")
    expect(two.totalCost).toBe(1)
  })

  test("returns empty metrics when inputs are undefined", () => {
    const metrics = getSessionContextMetrics(undefined, undefined)

    expect(metrics.totalCost).toBe(0)
    expect(metrics.context).toBeUndefined()
    expect(metrics.subagents).toEqual([])
    expect(metrics.subagentTokens).toBe(0)
    expect(metrics.totalTokens).toBe(0)
    expect(metrics.totalExecutionMs).toBe(0)
  })
})

describe("sessionContextHistoryInput", () => {
  test("waits for idle sessions with assistant history before loading full histories", () => {
    const child = session("ses_child", "ses_parent")
    const messages = {
      ses_parent: [user("u1"), assistant("a1", { input: 1, output: 1, reasoning: 0, read: 0, write: 0 }, 0)],
      ses_child: [assistant("child", { input: 1, output: 1, reasoning: 0, read: 0, write: 0 }, 0)],
    }

    expect(
      sessionContextHistoryInput({
        sessionID: "ses_parent",
        childSessions: [child],
        messages: { ses_parent: [user("u1")] },
        statuses: {},
      }),
    ).toBeUndefined()
    expect(
      sessionContextHistoryInput({
        sessionID: "ses_parent",
        childSessions: [child],
        messages,
        statuses: { ses_child: busy },
      }),
    ).toBeUndefined()
    expect(
      sessionContextHistoryInput({
        sessionID: "ses_parent",
        childSessions: [child],
        messages,
        statuses: {},
      }),
    ).toEqual({
      sessionID: "ses_parent",
      childSessions: [child],
    })
  })
})
