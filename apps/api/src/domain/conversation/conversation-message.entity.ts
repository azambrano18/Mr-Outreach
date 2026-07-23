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
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  senderEmail: string;
  senderName: string | null;
  recipients: string[];
  cc: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
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
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  senderEmail: string;
  senderName?: string | null;
  recipients: string[];
  cc?: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
  receivedAt?: Date | null;
  sentAt?: Date | null;
  messageType: ConversationMessageType;
}
