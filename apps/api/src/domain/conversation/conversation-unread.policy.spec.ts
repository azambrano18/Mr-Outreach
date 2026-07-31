import { isConversationUnreadForUser } from './conversation-unread.policy';

describe('isConversationUnreadForUser', () => {
  const inbound = (id: string, receivedAt: string) => ({ id, receivedAt: new Date(receivedAt) });
  const readState = (lastReadAt: string, lastReadMessageId: string | null) => ({
    lastReadAt: new Date(lastReadAt),
    lastReadMessageId,
  });

  it('is never unread when no inbound message has ever arrived', () => {
    expect(isConversationUnreadForUser(null, null)).toBe(false);
    expect(isConversationUnreadForUser(null, readState('2026-01-01T00:00:00Z', null))).toBe(false);
  });

  it('is unread when an inbound message exists but the user has no read state at all', () => {
    expect(isConversationUnreadForUser(inbound('msg_1', '2026-01-01T00:00:00Z'), null)).toBe(true);
  });

  it('is unread when the last inbound message arrived after the user last read', () => {
    const result = isConversationUnreadForUser(
      inbound('msg_2', '2026-01-02T00:00:00Z'),
      readState('2026-01-01T00:00:00Z', 'msg_1'),
    );
    expect(result).toBe(true);
  });

  it('is read when the user read strictly after the last inbound message arrived', () => {
    const result = isConversationUnreadForUser(
      inbound('msg_1', '2026-01-01T00:00:00Z'),
      readState('2026-01-02T00:00:00Z', 'msg_1'),
    );
    expect(result).toBe(false);
  });

  it('is read when the user read strictly after the last inbound message, even if a later OUTBOUND message changed lastReadMessageId', () => {
    // The read happened after an outbound-only follow-up (e.g. Step 3 auto-sent after the prospect
    // already replied to Step 2) — lastReadMessageId then refers to that outbound message, not the
    // inbound one. Must never be treated as "still unread" just because the ids differ.
    const result = isConversationUnreadForUser(
      inbound('inbound_msg', '2026-01-01T00:00:00Z'),
      readState('2026-01-03T00:00:00Z', 'outbound_msg_sent_later'),
    );
    expect(result).toBe(false);
  });

  it('breaks an exact-timestamp tie by id — treated as unread when the ids differ', () => {
    const result = isConversationUnreadForUser(
      inbound('inbound_msg', '2026-01-01T00:00:00.000Z'),
      readState('2026-01-01T00:00:00.000Z', 'some_other_message'),
    );
    expect(result).toBe(true);
  });

  it('breaks an exact-timestamp tie by id — treated as read when the ids match', () => {
    const result = isConversationUnreadForUser(
      inbound('inbound_msg', '2026-01-01T00:00:00.000Z'),
      readState('2026-01-01T00:00:00.000Z', 'inbound_msg'),
    );
    expect(result).toBe(false);
  });
});
