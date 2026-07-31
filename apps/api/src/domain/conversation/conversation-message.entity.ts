export type ConversationDirection = 'INBOUND' | 'OUTBOUND';

export type ConversationMessageType =
  | 'HUMAN_REPLY'
  | 'OUTREACH_EMAIL'
  | 'AUTO_REPLY'
  | 'OUT_OF_OFFICE'
  | 'HARD_BOUNCE'
  | 'SOFT_BOUNCE'
  | 'UNSUBSCRIBE'
  | 'UNKNOWN';

export interface ConversationMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  mailboxId: string;
  /** The engine's message id (`InboxMessageResult.id`) — how sync avoids inserting the same message twice. */
  emailMessageId: string;
  direction: ConversationDirection;
  /** The motor's own identifier for this message and, for an OUTBOUND send, the id later replies anchor their In-Reply-To/References to. No contractual evidence of global uniqueness yet — see docs/database-architecture.md. */
  serverMessageId: string | null;
  outboundMessageId: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  senderEmail: string;
  senderName: string | null;
  recipients: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
  /** Which envío (1/2/3) of the active-flow template this message corresponds to, when known. */
  stepNumber: number | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  messageType: ConversationMessageType;
  createdAt: Date;
}

export interface CreateConversationMessageInput {
  organizationId: string;
  conversationId: string;
  mailboxId: string;
  emailMessageId: string;
  direction: ConversationDirection;
  serverMessageId?: string | null;
  outboundMessageId?: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  senderEmail: string;
  senderName?: string | null;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
  stepNumber?: number | null;
  receivedAt?: Date | null;
  sentAt?: Date | null;
  messageType: ConversationMessageType;
}
