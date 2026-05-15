import { Match, Show, Switch, createEffect, createMemo, createResource } from "solid-js"
import { Tooltip, type TooltipProps } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"
import { checksum } from "@opencode-ai/core/util/encode"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useProviders } from "@/hooks/use-providers"
import { authTokenFromCredentials } from "@/utils/server"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import {
  loadSessionContextMessages,
  sessionContextHistoryInput,
} from "@/components/session/session-context-metrics-data"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: TooltipProps["placement"]
}

type MetricsSnapshot = {
  schema: "opencode.context_metrics.v1"
  time: {
    created: string
    epochMs: number
  }
  project: {
    id: string
    directory: string
    workspaceID?: string
  }
  session: {
    id: string
    title: string
    created: number
    lastActivity: number
  }
  context: {
    provider?: string
    providerID?: string
    model?: string
    modelID?: string
    limit?: number
    usagePercent: number | null
    currentContextTokens: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  totals: {
    messages: number
    userMessages: number
    assistantMessages: number
    tokens: number
    usage: {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      freshTokens: number
      cacheInclusiveTokens: number
    }
    costUsd: number
    executionMs: number
  }
  subagents: {
    count: number
    tokens: number
    items: {
      sessionID: string
      parentSessionID: string
      title: string
      agent?: string
      depth: number
      tokens: number
      executionMs: number
    }[]
  }
}

const lastMetricsHash = new Map<string, string>()
const pendingMetricsHash = new Map<string, string>()

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  if (!args.view.reviewPanel.opened()) args.view.reviewPanel.open()
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const sdk = useSDK()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const settings = useSettings()
  const providers = useProviders()
  const { params, tabs, view } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const [subagents] = createResource(
    () => params.id,
    async (sessionID) => (await sdk.client.session.children({ sessionID })).data ?? [],
  )

  createEffect(() => {
    for (const subagent of subagents() ?? []) void sync.session.sync(subagent.id)
  })
  const [histories] = createResource(
    () =>
      sessionContextHistoryInput({
        sessionID: params.id,
        childSessions: subagents(),
        messages: sync.data.message,
        statuses: sync.data.session_status,
      }),
    (input) =>
      loadSessionContextMessages({
        client: sdk.client,
        sessionID: input.sessionID,
        childSessions: input.childSessions,
      }),
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() =>
    getSessionContextMetrics(messages(), providers.all(), {
      sessionID: params.id,
      sessions: [...sync.data.session, ...(subagents() ?? [])],
      messages: sync.data.message,
      histories: histories(),
    }),
  )
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => {
    return usd().format(metrics().totalCost)
  })

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    if (!settings.metrics.logUsage()) return
    if ((sync.data.session_status[sessionID]?.type ?? "idle") !== "idle") return

    const info = sync.session.get(sessionID)
    if (!info) return

    const m = metrics()
    const ctx = m.context
    if (!ctx && m.subagents.length === 0) return

    const currentMessages = messages()
    const userMessages = currentMessages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0)
    const assistantMessages = currentMessages.reduce(
      (count, message) => count + (message.role === "assistant" ? 1 : 0),
      0,
    )
    const now = Date.now()
    const snapshot: MetricsSnapshot = {
      schema: "opencode.context_metrics.v1",
      time: {
        created: new Date(now).toISOString(),
        epochMs: now,
      },
      project: {
        id: info.projectID,
        directory: info.directory,
        ...(info.workspaceID ? { workspaceID: info.workspaceID } : {}),
      },
      session: {
        id: info.id,
        title: info.title,
        created: info.time.created,
        lastActivity: info.time.updated ?? ctx?.message.time.created ?? info.time.created,
      },
      context: {
        provider: ctx?.providerLabel,
        providerID: ctx?.message.providerID,
        model: ctx?.modelLabel,
        modelID: ctx?.message.modelID,
        limit: ctx?.limit,
        usagePercent: ctx?.usage ?? null,
        currentContextTokens: ctx?.total ?? 0,
        inputTokens: ctx?.input ?? 0,
        outputTokens: ctx?.output ?? 0,
        reasoningTokens: ctx?.reasoning ?? 0,
        cacheReadTokens: ctx?.cacheRead ?? 0,
        cacheWriteTokens: ctx?.cacheWrite ?? 0,
      },
      totals: {
        messages: currentMessages.length,
        userMessages,
        assistantMessages,
        tokens: m.totalTokens,
        usage: {
          inputTokens: m.usage.input,
          outputTokens: m.usage.output,
          reasoningTokens: m.usage.reasoning,
          cacheReadTokens: m.usage.cacheRead,
          cacheWriteTokens: m.usage.cacheWrite,
          freshTokens: m.usage.fresh,
          cacheInclusiveTokens: m.usage.cacheInclusive,
        },
        costUsd: m.totalCost,
        executionMs: m.totalExecutionMs,
      },
      subagents: {
        count: m.subagents.length,
        tokens: m.subagentTokens,
        items: m.subagents.map((subagent) => ({
          sessionID: subagent.sessionID,
          parentSessionID: subagent.parentSessionID,
          title: subagent.title,
          ...(subagent.agent ? { agent: subagent.agent } : {}),
          depth: subagent.depth,
          tokens: subagent.tokens,
          executionMs: subagent.executionMs,
        })),
      },
    }

    const { time: _time, session: { lastActivity: _lastActivity, ...sessionWithoutLastActivity }, ...restSnapshot } = snapshot
    const hash = checksum(JSON.stringify({ ...restSnapshot, session: sessionWithoutLastActivity }))
    if (!hash) return
    if (lastMetricsHash.get(sessionID) === hash || pendingMetricsHash.get(sessionID) === hash) return

    const currentServer = server.current
    if (!currentServer) return
    const fetchMetrics = platform.fetch ?? fetch
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-opencode-directory": encodeURIComponent(info.directory),
    }
    if (info.workspaceID) headers["x-opencode-workspace"] = info.workspaceID
    if (currentServer.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: currentServer.http.username,
        password: currentServer.http.password,
      })}`
    }

    pendingMetricsHash.set(sessionID, hash)
    const url = `${currentServer.http.url.replace(/\/+$/, "")}/session/${encodeURIComponent(sessionID)}/metrics`
    void fetchMetrics(url, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`metrics log failed: ${response.status}`)
        lastMetricsHash.set(sessionID, hash)
      })
      .catch((error) => {
        console.warn("[metrics] failed to log context metrics", error)
      })
      .finally(() => {
        if (pendingMetricsHash.get(sessionID) === hash) pendingMetricsHash.delete(sessionID)
      })
  })

  const openContext = () => {
    if (!params.id) return

    if (tabState.activeTab() === "context") {
      tabs().close("context")
      return
    }
    openSessionContext({
      view: view(),
      layout,
      tabs: tabs(),
    })
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div>
      <Show when={context()}>
        {(ctx) => (
          <>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().total.toLocaleString(language.intl())}</span>
              <span class="text-text-invert-base">{language.t("context.usage.currentContextTokens")}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
              <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
            </div>
          </>
        )}
      </Show>
      <Show when={metrics().subagentTokens > 0}>
        <div class="flex items-center gap-2">
          <span class="text-text-invert-strong">{metrics().subagentTokens.toLocaleString(language.intl())}</span>
          <span class="text-text-invert-base">{language.t("context.usage.subagentTokens")}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-invert-strong">{metrics().totalTokens.toLocaleString(language.intl())}</span>
          <span class="text-text-invert-base">{language.t("context.usage.totalTokens")}</span>
        </div>
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
      </div>
    </div>
  )

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"}>
        <Switch>
          <Match when={variant() === "indicator"}>{circle()}</Match>
          <Match when={true}>
            <Button
              type="button"
              variant="ghost"
              class="size-6"
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            >
              {circle()}
            </Button>
          </Match>
        </Switch>
      </Tooltip>
    </Show>
  )
}
