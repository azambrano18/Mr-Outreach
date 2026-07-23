import type { EngineProtocolTestInput } from '../../../domain/engine/engine-client';
import { MockEngineClient } from './mock-engine-client';

const protocol: EngineProtocolTestInput = {
  host: 'imap.example.com',
  port: 993,
  encryption: 'SSL_TLS',
  username: 'user@example.com',
  password: 'irrelevant-for-the-mock',
  verifyCertificate: true,
};

function testInput(email: string) {
  return { email, imap: protocol, smtp: protocol };
}

describe('MockEngineClient', () => {
  let client: MockEngineClient;

  beforeEach(() => {
    client = new MockEngineClient();
  });

  it('defaults to a successful connection when no scenario was registered', async () => {
    const result = await client.testMailbox(testInput('unregistered@example.com'));

    expect(result.status).toBe('CONNECTED');
    expect(result.imap.success).toBe(true);
    expect(result.smtp.success).toBe(true);
    expect(typeof result.testedAt).toBe('string');
  });

  it('is deterministic, not random: the same email always returns the registered scenario', async () => {
    client.setScenario('flaky@example.com', 'PARTIALLY_CONNECTED');

    const first = await client.testMailbox(testInput('flaky@example.com'));
    const second = await client.testMailbox(testInput('FLAKY@example.com'));

    expect(first.status).toBe('PARTIALLY_CONNECTED');
    expect(second.status).toBe('PARTIALLY_CONNECTED');
    expect(first.smtp.errorCode).toBe('SMTP_AUTH_FAILED');
  });

  it.each([
    ['CREDENTIALS_ERROR', 'CONNECTION_ERROR'],
    ['TIMEOUT', 'CONNECTION_ERROR'],
    ['TLS_ERROR', 'CONNECTION_ERROR'],
    ['IMAP_UNAVAILABLE', 'PARTIALLY_CONNECTED'],
    ['SMTP_UNAVAILABLE', 'PARTIALLY_CONNECTED'],
    ['ENGINE_UNAVAILABLE', 'ENGINE_UNAVAILABLE'],
  ] as const)('maps the %s scenario to status %s', async (scenario, expectedStatus) => {
    client.setScenario('scenario@example.com', scenario);

    const result = await client.testMailbox(testInput('scenario@example.com'));

    expect(result.status).toBe(expectedStatus);
  });

  it('forgets scenarios after clearScenarios()', async () => {
    client.setScenario('temp@example.com', 'ENGINE_UNAVAILABLE');
    client.clearScenarios();

    const result = await client.testMailbox(testInput('temp@example.com'));

    expect(result.status).toBe('CONNECTED');
  });

  it.each([
    ['ventas+timeout@example.com', 'CONNECTION_ERROR'],
    ['ventas+credenciales@example.com', 'CONNECTION_ERROR'],
    ['ventas+tls@example.com', 'CONNECTION_ERROR'],
    ['ventas+imapdown@example.com', 'PARTIALLY_CONNECTED'],
    ['ventas+smtpdown@example.com', 'PARTIALLY_CONNECTED'],
    ['ventas+parcial@example.com', 'PARTIALLY_CONNECTED'],
    ['ventas+motorcaido@example.com', 'ENGINE_UNAVAILABLE'],
  ] as const)(
    'resolves the "+tag" convention on %s to status %s',
    async (email, expectedStatus) => {
      const result = await client.testMailbox(testInput(email));

      expect(result.status).toBe(expectedStatus);
    },
  );

  it('an explicitly registered scenario takes priority over the "+tag" convention', async () => {
    client.setScenario('ventas+timeout@example.com', 'CONNECTED');

    const result = await client.testMailbox(testInput('ventas+timeout@example.com'));

    expect(result.status).toBe('CONNECTED');
  });

  it('always reports itself as available', async () => {
    await expect(client.checkHealth()).resolves.toBe('available');
  });

  describe('fetchInbox / fetchThread', () => {
    it('returns a non-empty, deterministic list of demo threads for a healthy mailbox', async () => {
      const first = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const second = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });

      expect(first.status).toBe('OK');
      expect(first.threads.length).toBeGreaterThan(0);
      expect(first.threads.map((t) => t.id)).toEqual(second.threads.map((t) => t.id));
    });

    it('returns a different (but still deterministic) thread order for a different mailbox', async () => {
      const ventas = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const soporte = await client.fetchInbox({ email: 'soporte@example.com', imap: protocol });

      expect(ventas.threads.map((t) => t.id)).not.toEqual(soporte.threads.map((t) => t.id));
    });

    it('respects the "+tag" convention: engine-unavailable and connection-error scenarios return no threads', async () => {
      const engineDown = await client.fetchInbox({
        email: 'ventas+motorcaido@example.com',
        imap: protocol,
      });
      const connectionError = await client.fetchInbox({
        email: 'ventas+timeout@example.com',
        imap: protocol,
      });

      expect(engineDown.status).toBe('ENGINE_UNAVAILABLE');
      expect(engineDown.threads).toEqual([]);
      expect(connectionError.status).toBe('CONNECTION_ERROR');
      expect(connectionError.threads).toEqual([]);
    });

    it('fetchThread returns the messages for a thread id that came from fetchInbox', async () => {
      const inbox = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const threadId = inbox.threads[0].id;

      const thread = await client.fetchThread({
        email: 'ventas@example.com',
        imap: protocol,
        threadId,
      });

      expect(thread.status).toBe('OK');
      expect(thread.messages.length).toBeGreaterThan(0);
      expect(thread.messages.every((m) => m.threadId === threadId)).toBe(true);
    });

    it('fetchThread reports NOT_FOUND for an unknown thread id', async () => {
      const thread = await client.fetchThread({
        email: 'ventas@example.com',
        imap: protocol,
        threadId: 'does-not-exist',
      });

      expect(thread.status).toBe('NOT_FOUND');
      expect(thread.messages).toEqual([]);
    });
  });

  describe('setThreadReadState', () => {
    it('marking a thread read zeroes its unreadCount on the next fetchInbox, and marks the last message read too', async () => {
      const inbox = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const threadId = inbox.threads[0].id;

      const result = await client.setThreadReadState({
        email: 'ventas@example.com',
        imap: protocol,
        threadId,
        isUnread: false,
      });
      expect(result.status).toBe('OK');

      const after = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const updatedThread = after.threads.find((t) => t.id === threadId);
      expect(updatedThread?.unreadCount).toBe(0);

      const thread = await client.fetchThread({
        email: 'ventas@example.com',
        imap: protocol,
        threadId,
      });
      expect(thread.messages.at(-1)?.isUnread).toBe(false);
    });

    it('marking a thread unread again restores a non-zero unreadCount', async () => {
      const inbox = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const threadId = inbox.threads[0].id;

      await client.setThreadReadState({
        email: 'ventas@example.com',
        imap: protocol,
        threadId,
        isUnread: false,
      });
      await client.setThreadReadState({
        email: 'ventas@example.com',
        imap: protocol,
        threadId,
        isUnread: true,
      });

      const after = await client.fetchInbox({ email: 'ventas@example.com', imap: protocol });
      const updatedThread = after.threads.find((t) => t.id === threadId);
      expect(updatedThread?.unreadCount).toBeGreaterThan(0);
    });

    it('returns NOT_FOUND for an unknown thread id', async () => {
      const result = await client.setThreadReadState({
        email: 'ventas@example.com',
        imap: protocol,
        threadId: 'does-not-exist',
        isUnread: false,
      });

      expect(result.status).toBe('NOT_FOUND');
    });
  });
});
