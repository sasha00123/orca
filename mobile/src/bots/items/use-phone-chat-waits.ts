// What a bot's waiting chats' own sessions wait on, read from the host's status feed: the approval,
// and whether the session waits at all (the chats tree may mark Home for a paired server's card).
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import * as z from 'zod'
import type { AgentSessionAwaitedApproval } from '../../../../src/shared/agent-session/agent-session-wire'
import type { BotChatTreeChat } from '../../../../src/shared/bots/bot-chat-tree'
import { useOptionalHostProtocolGates } from '../../components/host-connection/host-protocol-gates-context'
import { structuredAgentSessionHostSupport } from '../../session/native-chat/agent-session/mobile-structured-agent-session-host-support'
import { mobileStructuredSessionStatusFeed } from '../../session/native-chat/agent-session/mobile-structured-session-status-feed'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'

const noSubscription = (): (() => void) => () => {}

/** What a waiting chat's own session says: the approval it waits on, and whether it waits at all. */
export type PhoneChatWait = { approval?: AgentSessionAwaitedApproval; own: boolean }

// The waiting chats' sessions as `useChatWaits` reads them: [session id, approval, waits] triples.
const ChatWaits = z.array(
  z.tuple([
    z.string(),
    z.object({ tool: z.string(), input: z.string().optional() }).nullable(),
    z.boolean()
  ])
)

/** The session whose status is the chat's: the one a /clear moved it to, else its own. */
export function chatSessionId(chat: BotChatTreeChat): string {
  return chat.liveSessionId ?? chat.chatId
}

/** What each waiting chat's session waits on, as its host's status feed says; none on a host without
 *  it. Read as one string, so other sessions' frames re-render nothing. */
export function useChatWaits(
  client: RpcClient | null,
  chats: readonly BotChatTreeChat[] | null
): (chat: BotChatTreeChat) => PhoneChatWait | undefined {
  const capabilities = useOptionalHostProtocolGates()?.hostCapabilities
  const statusFeed = useMemo(
    () => structuredAgentSessionHostSupport(capabilities ?? []).statusFeed,
    [capabilities]
  )
  const feed = client && statusFeed ? mobileStructuredSessionStatusFeed(client) : null
  const waiting = useMemo(
    () => (chats ?? []).filter((chat) => chat.live === 'needs-you').map(chatSessionId),
    [chats]
  )
  const subscribe = useCallback(
    (listener: () => void) => (feed ? feed.subscribe(listener) : noSubscription()),
    [feed]
  )
  const read = useCallback(() => {
    const snapshot = feed?.getSnapshot()
    return JSON.stringify(
      waiting.flatMap((id) => {
        const status = snapshot?.get(id)
        return status
          ? [
              [
                id,
                status.awaitsApproval ?? null,
                status.status === 'attention' || status.awaitsAnswer === true
              ]
            ]
          : []
      })
    )
  }, [feed, waiting])
  const waits = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => {
    const byId = new Map(
      ChatWaits.parse(JSON.parse(waits)).map(([id, approval, own]): [string, PhoneChatWait] => [
        id,
        approval ? { approval, own } : { own }
      ])
    )
    return (chat: BotChatTreeChat) => byId.get(chatSessionId(chat))
  }, [waits])
}
