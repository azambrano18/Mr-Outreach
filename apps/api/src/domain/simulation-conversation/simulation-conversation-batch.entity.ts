/**
 * "Conversaciones de prueba" (QA) — a single generation of the 4 fixed
 * scenario conversations (Interesado/No interesado/No contactar/Deriva)
 * against one real, staging-only Mailbox. Deliberately holds no relation
 * arrays to Contact/Company/Sequence/SequenceContact: those are found by
 * querying `Conversation.simulationBatchId` at deletion time, since every
 * synthetic row is reachable from its Conversation's own foreign keys —
 * see DeleteSimulationConversationsUseCase.
 */
export interface SimulationConversationBatch {
  id: string;
  organizationId: string;
  mailboxId: string;
  createdByUserId: string;
  idempotencyKey: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface CreateSimulationConversationBatchInput {
  organizationId: string;
  mailboxId: string;
  createdByUserId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
}
