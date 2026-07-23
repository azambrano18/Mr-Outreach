export type EngineProtocolEncryption = 'SSL_TLS' | 'STARTTLS' | 'NONE';

export interface EngineProtocolTestInput {
  host: string;
  port: number;
  encryption: EngineProtocolEncryption;
  username: string;
  /** Plaintext, decrypted just before this call — never persisted or logged. */
  password: string;
  verifyCertificate: boolean;
}

export interface TestMailboxInput {
  email: string;
  imap: EngineProtocolTestInput;
  smtp: EngineProtocolTestInput;
}

/**
 * The four possible outcomes of a single test call. Distinct from
 * domain/mailbox's MailboxConnectionStatus (which also has NOT_TESTED and
 * TESTING — states a mailbox can be in between tests, not results a test
 * itself can return).
 */
export type EngineTestStatus =
  'CONNECTED' | 'PARTIALLY_CONNECTED' | 'CONNECTION_ERROR' | 'ENGINE_UNAVAILABLE';

export interface TestMailboxResult {
  status: EngineTestStatus;
  imap: { success: boolean; errorCode?: string };
  smtp: { success: boolean; errorCode?: string };
  testedAt: string;
}

export type EngineHealthStatus = 'available' | 'unavailable';

/**
 * A one-off send (signature test send, step test send — never a real
 * campaign send, which belongs to the not-yet-built Sequences/Steps
 * domain). Uses the mailbox's own SMTP config, decrypted just before the
 * call, same as TestMailboxInput.
 */
export interface SendMailInput {
  /** Used only for the mock driver's "+tag" scenario convention. */
  mailboxEmail: string;
  smtp: EngineProtocolTestInput;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  accepted: boolean;
  smtpResponseCode?: string;
  errorCode?: string;
  messageId?: string;
}

export interface InboxParticipant {
  name: string | null;
  email: string;
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface InboxMessageResult {
  id: string;
  threadId: string;
  from: InboxParticipant;
  to: InboxParticipant[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  direction: MessageDirection;
  isUnread: boolean;
  receivedAt: string;
}

export interface InboxThreadResult {
  id: string;
  subject: string;
  participants: InboxParticipant[];
  lastMessageAt: string;
  lastMessageSnippet: string;
  unreadCount: number;
  messageCount: number;
}

/** Distinct from EngineTestStatus: this is the result of *reading* a mailbox, not testing its credentials. */
export type InboxFetchStatus = 'OK' | 'CONNECTION_ERROR' | 'ENGINE_UNAVAILABLE';

export interface FetchInboxInput {
  email: string;
  imap: EngineProtocolTestInput;
}

export interface FetchInboxResult {
  status: InboxFetchStatus;
  threads: InboxThreadResult[];
}

export interface FetchThreadInput {
  email: string;
  imap: EngineProtocolTestInput;
  threadId: string;
}

export interface FetchThreadResult {
  status: InboxFetchStatus | 'NOT_FOUND';
  messages: InboxMessageResult[];
}

export interface SetThreadReadInput {
  email: string;
  imap: EngineProtocolTestInput;
  threadId: string;
  isUnread: boolean;
}

export interface SetThreadReadResult {
  status: InboxFetchStatus | 'NOT_FOUND';
}

/**
 * Port. MockEngineClient and HttpEngineClient both implement this; the
 * application layer never knows which one is active.
 */
export interface EngineClient {
  testMailbox(input: TestMailboxInput): Promise<TestMailboxResult>;
  sendMail(input: SendMailInput): Promise<SendMailResult>;
  checkHealth(): Promise<EngineHealthStatus>;
  /**
   * Real IMAP polling belongs to the separately developed execution
   * engine (see README's opening paragraph) — this app never connects to
   * a mail server directly, even for reading. MockEngineClient returns
   * deterministic demo threads; HttpEngineClient forwards to the real
   * engine once it exists.
   */
  fetchInbox(input: FetchInboxInput): Promise<FetchInboxResult>;
  fetchThread(input: FetchThreadInput): Promise<FetchThreadResult>;
  /** Toggles a thread's unread state. Same "no real IMAP here" rule as fetchInbox/fetchThread. */
  setThreadReadState(input: SetThreadReadInput): Promise<SetThreadReadResult>;
}
