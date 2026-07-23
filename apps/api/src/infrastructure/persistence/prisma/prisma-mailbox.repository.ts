import { Injectable } from '@nestjs/common';
import { Mailbox as PrismaMailboxRow } from '@prisma/client';
import {
  CreateMailboxInput,
  Mailbox,
  MailboxProtocolConfig,
  UpdateMailboxInput,
} from '../../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../../domain/mailbox/mailbox.repository';
import { PrismaService } from './prisma.service';

function toImap(row: PrismaMailboxRow): MailboxProtocolConfig {
  return {
    host: row.imapHost,
    port: row.imapPort,
    encryption: row.imapEncryption,
    username: row.imapUsername,
    verifyCertificate: row.imapVerifyCertificate,
    secretCiphertext: row.imapSecretCiphertext,
  };
}

function toSmtp(row: PrismaMailboxRow): MailboxProtocolConfig {
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    encryption: row.smtpEncryption,
    username: row.smtpUsername,
    verifyCertificate: row.smtpVerifyCertificate,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaMailboxRepository implements MailboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Mailbox | null> {
    const row = await this.prisma.mailbox.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(organizationId: string, email: string): Promise<Mailbox | null> {
    const row = await this.prisma.mailbox.findFirst({
      where: { organizationId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<Mailbox[]> {
    const rows = await this.prisma.mailbox.findMany({ where: { organizationId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateMailboxInput): Promise<Mailbox> {
    const row = await this.prisma.mailbox.create({
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

  async update(id: string, input: UpdateMailboxInput): Promise<Mailbox> {
    const row = await this.prisma.mailbox.update({
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
