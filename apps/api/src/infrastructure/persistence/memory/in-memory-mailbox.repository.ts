import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateLinkedMailboxInput,
  CreateMailboxInput,
  Mailbox,
  UpdateMailboxInput,
} from '../../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../../domain/mailbox/mailbox.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryMailboxRepository implements MailboxRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Mailbox | null> {
    const mailbox = this.store.mailboxes.get(id);
    return mailbox && !mailbox.deletedAt ? mailbox : null;
  }

  async findByIdIncludingDeleted(id: string): Promise<Mailbox | null> {
    return this.store.mailboxes.get(id) ?? null;
  }

  async findByEmail(organizationId: string, email: string): Promise<Mailbox | null> {
    const normalized = email.toLowerCase();
    for (const mailbox of this.store.mailboxes.values()) {
      if (
        !mailbox.deletedAt &&
        mailbox.organizationId === organizationId &&
        mailbox.email.toLowerCase() === normalized
      ) {
        return mailbox;
      }
    }
    return null;
  }

  async findByServerMailboxId(serverMailboxId: string): Promise<Mailbox | null> {
    for (const mailbox of this.store.mailboxes.values()) {
      if (!mailbox.deletedAt && mailbox.serverMailboxId === serverMailboxId) {
        return mailbox;
      }
    }
    return null;
  }

  async findAll(organizationId: string): Promise<Mailbox[]> {
    return Array.from(this.store.mailboxes.values()).filter(
      (mailbox) => !mailbox.deletedAt && mailbox.organizationId === organizationId,
    );
  }

  async create(input: CreateMailboxInput): Promise<Mailbox> {
    const existing = await this.findByEmail(input.organizationId, input.email);
    if (existing) {
      throw new ConflictException('A mailbox with this email already exists in the organization.');
    }

    const now = new Date();
    const mailbox: Mailbox = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: null,
      domainId: null,
      name: input.name,
      email: input.email,
      fromName: input.fromName,
      replyTo: input.replyTo ?? null,
      status: 'ACTIVE',
      connectionStatus: 'NOT_TESTED',
      provisioningStatus: 'NOT_PROVISIONED',
      timezone: input.timezone ?? 'America/Santiago',
      sendingLimits: input.sendingLimits ?? {
        dailyLimit: 40,
        minimumIntervalSeconds: 60,
        maximumIntervalSeconds: 180,
      },
      lastProvisionCommandId: null,
      lastTestedAt: null,
      lastTestedBy: null,
      lastTestMessage: null,
      imap: input.imap,
      smtp: input.smtp,
      linkSource: 'LEGACY_LOCAL',
      linkStatus: 'LEGACY',
      serverMailboxId: null,
      serverDomainId: null,
      serverClientId: null,
      serverRedemptionId: null,
      tokenFingerprint: null,
      emailSnapshot: null,
      domainSnapshot: null,
      clientNameSnapshot: null,
      serverStatusSnapshot: null,
      serverCanSendSnapshot: null,
      serverStatusCheckedAt: null,
      linkedAt: null,
      linkedBy: null,
      unlinkRequestedAt: null,
      unlinkRequestedBy: null,
      unlinkReason: null,
      unlinkRemoveAssignments: false,
      revokedAt: null,
      revocationId: null,
      lastLinkCommandId: null,
      assetCleanupStatus: 'NOT_NEEDED',
      assetCleanupAttempts: 0,
      lastAssetCleanupError: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.mailboxes.set(mailbox.id, mailbox);
    return mailbox;
  }

  async createLinked(input: CreateLinkedMailboxInput): Promise<Mailbox> {
    const existing = await this.findByServerMailboxId(input.serverMailboxId);
    if (existing) {
      throw new ConflictException('This server mailbox is already linked.');
    }

    const now = new Date();
    const mailbox: Mailbox = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      domainId: input.domainId,
      name: input.name,
      email: input.email,
      fromName: input.fromName,
      replyTo: null,
      status: 'ACTIVE',
      connectionStatus: 'NOT_TESTED',
      provisioningStatus: 'NOT_PROVISIONED',
      timezone: 'America/Santiago',
      sendingLimits: { dailyLimit: 40, minimumIntervalSeconds: 60, maximumIntervalSeconds: 180 },
      lastProvisionCommandId: null,
      lastTestedAt: null,
      lastTestedBy: null,
      lastTestMessage: null,
      imap: null,
      smtp: null,
      linkSource: 'SERVER_TOKEN',
      linkStatus: 'ACTIVE',
      serverMailboxId: input.serverMailboxId,
      serverDomainId: input.serverDomainId,
      serverClientId: input.serverClientId,
      serverRedemptionId: input.serverRedemptionId,
      tokenFingerprint: input.tokenFingerprint,
      emailSnapshot: input.emailSnapshot,
      domainSnapshot: input.domainSnapshot,
      clientNameSnapshot: input.clientNameSnapshot,
      serverStatusSnapshot: input.serverStatusSnapshot,
      serverCanSendSnapshot: input.serverCanSendSnapshot,
      serverStatusCheckedAt: input.serverStatusCheckedAt,
      linkedAt: input.linkedAt,
      linkedBy: input.linkedBy,
      unlinkRequestedAt: null,
      unlinkRequestedBy: null,
      unlinkReason: null,
      unlinkRemoveAssignments: false,
      revokedAt: null,
      revocationId: null,
      lastLinkCommandId: input.lastLinkCommandId,
      assetCleanupStatus: 'NOT_NEEDED',
      assetCleanupAttempts: 0,
      lastAssetCleanupError: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.mailboxes.set(mailbox.id, mailbox);
    return mailbox;
  }

  async update(id: string, input: UpdateMailboxInput): Promise<Mailbox> {
    const existing = this.store.mailboxes.get(id);
    if (!existing) {
      throw new ConflictException('Mailbox not found.');
    }
    // Fase 2 (R2) — an already-deleted mailbox must still be updatable for
    // its assetCleanupStatus/Attempts/lastAssetCleanupError fields (see
    // DeleteMailboxUseCase's post-commit cleanup and
    // RetryMailboxAssetCleanupUseCase). Matches PrismaMailboxRepository.update,
    // which never filtered by deletedAt either.

    const updated: Mailbox = {
      ...existing,
      ...input,
      imap: input.imap && existing.imap ? { ...existing.imap, ...input.imap } : existing.imap,
      smtp: input.smtp && existing.smtp ? { ...existing.smtp, ...input.smtp } : existing.smtp,
      sendingLimits: input.sendingLimits
        ? { ...existing.sendingLimits, ...input.sendingLimits }
        : existing.sendingLimits,
      updatedAt: new Date(),
    };
    this.store.mailboxes.set(id, updated);
    return updated;
  }
}
