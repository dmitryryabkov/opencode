import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))
  const tokenTotal = (message: AssistantMessage) =>
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  const last = createMemo(() =>
    msg().findLast((item): item is AssistantMessage => item.role === "assistant" && tokenTotal(item) > 0),
  )
  const isCompaction = (message: AssistantMessage) => message.mode === "compaction" || message.summary === true
  const sessionTokens = (sessionID: string) => {
    const message = props.api.state.session
      .messages(sessionID)
      .findLast((item): item is AssistantMessage => item.role === "assistant" && tokenTotal(item) > 0)
    const compacted = props.api.state.session.compactionTokens(sessionID)
    return (
      (message ? tokenTotal(message) : 0) - (message && isCompaction(message) ? tokenTotal(message) : 0) + compacted
    )
  }

  const state = createMemo(() => {
    const message = last()
    if (!message) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens = tokenTotal(message)
    const model = props.api.state.provider.find((item) => item.id === message.providerID)?.models[message.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const totalTokens = createMemo(() => {
    const childTokens = props.api.state.session
      .sessions()
      .filter((session) => session.parentID === props.session_id)
      .reduce((sum, child) => sum + sessionTokens(child.id), 0)

    return sessionTokens(props.session_id) + childTokens
  })

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="column">
        <text fg={theme().text}>
          <b>Context</b>
        </text>
        <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
        <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      </box>
      <box flexDirection="column">
        <text fg={theme().text}>
          <b>Total</b>
        </text>
        <text fg={theme().textMuted}>{totalTokens().toLocaleString()} tokens</text>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
