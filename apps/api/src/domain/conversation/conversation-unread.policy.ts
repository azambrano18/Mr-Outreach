/**
 * Fase "Estado leído/no leído por usuario" — the actual per-user unread
 * rule, kept as a pure function (no I/O) so it is trivially unit-testable
 * without mocking any repository. `Conversation.isUnread` (the coarse,
 * global flag written by the IMAP sync and by MotorEventProjector) is
 * never consulted here — it stays a legacy/motor-facing signal, never the
 * source of what a specific user sees as unread.
 *
 * A conversation is unread for a user when:
 *  1. it has at least one inbound message at all (an outbound-only
 *     conversation is never "unread" for anyone — nothing has arrived
 *     yet to read); AND, if so,
 *  2. no ConversationReadState exists yet for that user; OR
 *  3. the last inbound message arrived strictly after `lastReadAt`; OR
 *  4. they tie exactly (same instant) but the ids differ — a defensive
 *     tie-breaker for clock-resolution edge cases, never used to
 *     re-flag a conversation the user has already read (comparing ids
 *     against a *later* unrelated outbound message would be wrong,
 *     which is why this only fires on an exact timestamp tie, not a
 *     blanket "ids don't match").
 */
export interface LastInboundMessageRef {
  id: string;
  receivedAt: Date;
}

export interface ReadStateRef {
  lastReadAt: Date;
  lastReadMessageId: string | null;
}

export function isConversationUnreadForUser(
  lastInbound: LastInboundMessageRef | null,
  readState: ReadStateRef | null,
): boolean {
  if (!lastInbound) return false;
  if (!readState) return true;
  const inboundTime = lastInbound.receivedAt.getTime();
  const readTime = readState.lastReadAt.getTime();
  if (inboundTime > readTime) return true;
  if (inboundTime === readTime && lastInbound.id !== readState.lastReadMessageId) return true;
  return false;
}
