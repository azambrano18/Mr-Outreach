import { Injectable } from '@nestjs/common';
import { Mailbox as PrismaMailboxRow } from '@prisma/client';
import {
  CreateLinkedMailboxInput,
  CreateMailboxInput,
  Mailbox,
  MailboxProtocolConfig,
  UpdateMailboxInput,
} from '../../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../../domain/mailbox/mailbox.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

/** Null whenever the account is SERVER_TOKEN-linked (see schema comment on the now-nullable imap* columns). */
function toImap(row: PrismaMailboxRow): MailboxProtocolConfig | null {
  if (row.imapHost === null || row.imapPort === null || row.imapEncryption === null || row.imapUsername === null || row.imapSecretCiphertext === null) {
    return null;
  }
  return {
    host: row.imapHost,
    port: row.imapPort,
    encryption: row.imapEncryption,
    username: row.imapUsername,
    verifyCertificate: row.imapVerifyCertificate ?? true,
    secretCiphertext: row.imapSecretCiphertext,
  };
}

function toSmtp(row: PrismaMailboxRow): MailboxProtocolConfig | null {
  if (row.smtpHost === null || row.smtpPort === null || row.smtpEncryption === null || row.smtpUsername === null || row.smtpSecretCiphertext === null) {
    return null;
  }
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    encryption: row.smtpEncryption,
    username: row.smtpUsername,
    verifyCertificate: row.smtpVerifyCertificate ?? true,
    secretCiphertext: row.smtpSecretCiphertext,
  };
}

function toDomain(row: PrismaMailboxRow): Mailbox {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    domainId: row.domainId,
    name: row.name,
    email: row.email,
    fromName: row.fromName,
    replyTo: row.replyTo,
    status: row.status,
    connectionStatus: row.connectionStatus,
    provisioningStatus: row.provisioningStatus,
    timezone: row.timezone,
    sendingLimits: {
      dailyLimit: row.dailyLimit,
      minimumIntervalSeconds: row.minimumIntervalSeconds,
      maximumIntervalSeconds: row.maximumIntervalSeconds,
    },
    lastProvisionCommandId: row.lastProvisionCommandId,
    lastTestedAt: row.lastTestedAt,
    lastTestedBy: row.lastTestedBy,
    lastTestMessage: row.lastTestMessage,
    imap: toImap(row),
    smtp: toSmtp(row),
    linkSource: row.linkSource,
    linkStatus: row.linkStatus,
    serverMailboxId: row.serverMailboxId,
    serverDomainId: row.serverDomainId,
    serverClientId: row.serverClientId,
    serverRedemptionId: row.serverRedemptionId,
    tokenFingerprint: row.tokenFingerprint,
    emailSnapshot: row.emailSnapshot,
    domainSnapshot: row.domainSnapshot,
    clientNameSnapshot: row.clientNameSnapshot,
    serverStatusSnapshot: row.serverStatusSnapshot,
    serverCanSendSnapshot: row.serverCanSendSnapshot,
    serverStatusCheckedAt: row.serverStatusCheckedAt,
    linkedAt: row.linkedAt,
    linkedBy: row.linkedBy,
    unlinkRequestedAt: row.unlinkRequestedAt,
    unlinkRequestedBy: row.unlinkRequestedBy,
    unlinkReason: row.unlinkReason,
    revokedAt: row.revokedAt,
    revocationId: row.revocationId,
    lastLinkCommandId: row.lastLinkCommandId,
    assetCleanupStatus: row.assetCleanupStatus,
    assetCleanupAttempts: row.assetCleanupAttempts,
    lastAssetCleanupError: row.lastAssetCleanupError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaMailboxRepository implements MailboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<Mailbox | null> {
    const row = await resolveClient(this.prisma, ctx).mailbox.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByIdIncludingDeleted(id: string, ctx?: TransactionContext): Promise<Mailbox | null> {
    const row = await resolveClient(this.prisma, ctx).mailbox.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(organizationId: string, email: string, ctx?: TransactionContext): Promise<Mailbox | null> {
    const row = await resolveClient(this.prisma, ctx).mailbox.findFirst({
      where: { organizationId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findByServerMailboxId(serverMailboxId: string, ctx?: TransactionContext): Promise<Mailbox | null> {
    const row = await resolveClient(this.prisma, ctx).mailbox.findFirst({ where: { serverMailboxId, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string, ctx?: TransactionContext): Promise<Mailbox[]> {
    const rows = await resolveClient(this.prisma, ctx).mailbox.findMany({ where: { organizationId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateMailboxInput, ctx?: TransactionContext): Promise<Mailbox> {
    const row = await resolveClient(this.prisma, ctx).mailbox.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        email: input.email,
        fromName: input.fromName,
        replyTo: input.replyTo ?? null,
        ...(input.timezone && { timezone: input.timezone }),
        ...(input.sendingLimits && {
          dailyLimit: input.sendingLimits.dailyLimit,
          minimumIntervalSeconds: input.sendingLimits.minimumIntervalSeconds,
          maximumIntervalSeconds: input.sendingLimits.maximumIntervalSeconds,
        }),
        imapHost: input.imap.host,
        imapPort: input.imap.port,
        imapEncryption: input.imap.encryption,
        imapUsername: input.imap.username,
        imapVerifyCertificate: input.imap.verifyCertificate,
        imapSecretCiphertext: input.imap.secretCiphertext,
        smtpHost: input.smtp.host,
        smtpPort: input.smtp.port,
        smtpEncryption: input.smtp.encryption,
        smtpUsername: input.smtp.username,
        smtpVerifyCertificate: input.smtp.verifyCertificate,
        smtpSecretCiphertext: input.smtp.secretCiphertext,
      },
    });
    return toDomain(row);
  }

  async createLinked(input: CreateLinkedMailboxInput, ctx?: TransactionContext): Promise<Mailbox> {
    const row = await resolveClient(this.prisma, ctx).mailbox.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        domainId: input.domainId,
        name: input.name,
        email: input.email,
        fromName: input.fromName,
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
        lastLinkCommandId: input.lastLinkCommandId,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateMailboxInput, ctx?: TransactionContext): Promise<Mailbox> {
    const row = await resolveClient(this.prisma, ctx).mailbox.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        fromName: input.fromName,
        replyTo: input.replyTo,
        status: input.status,
        connectionStatus: input.connectionStatus,
        provisioningStatus: input.provisioningStatus,
        lastProvisionCommandId: input.lastProvisionCommandId,
        timezone: input.timezone,
        clientId: input.clientId,
        domainId: input.domainId,
        lastTestedAt: input.lastTestedAt,
        lastTestedBy: input.lastTestedBy,
        lastTestMessage: input.lastTestMessage,
        linkStatus: input.linkStatus,
        serverStatusSnapshot: input.serverStatusSnapshot,
        serverCanSendSnapshot: input.serverCanSendSnapshot,
        serverStatusCheckedAt: input.serverStatusCheckedAt,
        unlinkRequestedAt: input.unlinkRequestedAt,
        unlinkRequestedBy: input.unlinkRequestedBy,
        unlinkReason: input.unlinkReason,
        revokedAt: input.revokedAt,
        revocationId: input.revocationId,
        lastLinkCommandId: input.lastLinkCommandId,
        assetCleanupStatus: input.assetCleanupStatus,
        assetCleanupAttempts: input.assetCleanupAttempts,
        lastAssetCleanupError: input.lastAssetCleanupError,
        ...(input.sendingLimits && {
          ...(input.sendingLimits.dailyLimit !== undefined && { dailyLimit: input.sendingLimits.dailyLimit }),
          ...(input.sendingLimits.minimumIntervalSeconds !== undefined && {
            minimumIntervalSeconds: input.sendingLimits.minimumIntervalSeconds,
          }),
          ...(input.sendingLimits.maximumIntervalSeconds !== undefined && {
            maximumIntervalSeconds: input.sendingLimits.maximumIntervalSeconds,
          }),
        }),
        ...(input.imap && {
          imapHost: input.imap.host,
          imapPort: input.imap.port,
          imapEncryption: input.imap.encryption,
          imapUsername: input.imap.username,
          imapVerifyCertificate: input.imap.verifyCertificate,
          imapSecretCiphertext: input.imap.secretCiphertext,
        }),
        ...(input.smtp && {
          smtpHost: input.smtp.host,
          smtpPort: input.smtp.port,
          smtpEncryption: input.smtp.encryption,
          smtpUsername: input.smtp.username,
          smtpVerifyCertificate: input.smtp.verifyCertificate,
          smtpSecretCiphertext: input.smtp.secretCiphertext,
        }),
      },
    });
    return toDomain(row);
  }
}
