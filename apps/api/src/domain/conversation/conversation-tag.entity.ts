export interface ConversationTag {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateConversationTagInput {
  organizationId: string;
  name: string;
  color: string;
  createdBy: string;
}

export interface UpdateConversationTagInput {
  name?: string;
  color?: string;
  deletedAt?: Date | null;
}
