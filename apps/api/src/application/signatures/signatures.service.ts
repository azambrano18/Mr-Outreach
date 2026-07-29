import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { extractTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { EngineClient } from '../../domain/engine/engine-client';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { SignatureVersion } from '../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { Signature, SignatureStatus } from '../../domain/signature/signature.entity';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { ENGINE_CLIENT } from '../../infrastructure/engine/tokens';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  ORGANIZATION_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { htmlToPlainText } from '../../infrastructure/security/html-to-plain-text';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { SignatureRenderContext, renderSignatureText } from './signature-variable-resolver';
import {
  SendTestSignatureResult,
  SignaturePreview,
  SignatureSummary,
  SignatureVersionSummary,
} from './signatures.types';

@Injectable()
export class SignaturesService {
  constructor(
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly versions: SignatureVersionRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY)
    private readonly assignments: MailboxAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(ENGINE_CLIENT) private readonly engineClient: EngineClient,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly secrets: SecretEncryptionService,
  ) {}

  /**
   * 404s when the mailbox has no signature yet — same convention as every
   * other single-resource GET in this API (never a bare `null` body: Nest
   * sends an empty response for a `null` return, which would break any
   * caller doing `await response.json()`).
   */
  async getByMailbox(organizationId: string, mailboxId: string): Promise<SignatureSummary> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);
    return this.toSummary(signature, await this.versions.findBySignature(signature.id));
  }

  async create(
    organizationId: string,
    mailboxId: string,
    htmlContent: string,
    plainTextContent: string | undefined,
    actorId: string,
  ): Promise<SignatureSummary> {
    await this.getOwnedMailbox(organizationId, mailboxId);

    const signature = await this.signatures.create({ organizationId, mailboxId });
    const version = await this.versions.create({
      signatureId: signature.id,
      ...this.buildContent(htmlContent, plainTextContent),
      createdBy: actorId,
    });
    const updated = await this.signatures.update(signature.id, { activeVersionId: version.id });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'signature.create',
      entityType: 'Signature',
      entityId: signature.id,
      metadata: { mailboxId },
    });

    return this.toSummary(updated, [version]);
  }

  /** Creates a new version and activates it immediately — history is kept, never overwritten in place. */
  async update(
    organizationId: string,
    mailboxId: string,
    htmlContent: string,
    plainTextContent: string | undefined,
    actorId: string,
  ): Promise<SignatureSummary> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);

    const version = await this.versions.create({
      signatureId: signature.id,
      ...this.buildContent(htmlContent, plainTextContent),
      createdBy: actorId,
    });
    const updated = await this.signatures.update(signature.id, { activeVersionId: version.id });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'signature.update',
      entityType: 'Signature',
      entityId: signature.id,
      metadata: { versionNumber: version.versionNumber },
    });

    return this.toSummary(updated, await this.versions.findBySignature(signature.id));
  }

  /** Reverts to an existing older version — never creates a new one. */
  async activateVersion(
    organizationId: string,
    mailboxId: string,
    versionId: string,
    actorId: string,
  ): Promise<SignatureSummary> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);

    const version = await this.versions.findById(versionId);
    if (!version || version.signatureId !== signature.id) {
      throw new NotFoundException('Signature version not found.');
    }

    const updated = await this.signatures.update(signature.id, { activeVersionId: version.id });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'signature.activate',
      entityType: 'Signature',
      entityId: signature.id,
      metadata: { versionNumber: version.versionNumber },
    });

    return this.toSummary(updated, await this.versions.findBySignature(signature.id));
  }

  async setStatus(
    organizationId: string,
    mailboxId: string,
    status: SignatureStatus,
    actorId: string,
  ): Promise<SignatureSummary> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);

    const updated = await this.signatures.update(signature.id, { status });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: status === 'ARCHIVED' ? 'signature.archive' : 'signature.restore',
      entityType: 'Signature',
      entityId: signature.id,
    });

    return this.toSummary(updated, await this.versions.findBySignature(signature.id));
  }

  async preview(organizationId: string, mailboxId: string): Promise<SignaturePreview> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);
    const version = await this.getActiveVersion(signature);

    const ctx = await this.buildRenderContext(organizationId, mailbox);
    const htmlVariables = extractTemplateVariables(version.htmlContent);
    const textVariables = extractTemplateVariables(version.plainTextContent);
    const allVariables = [...new Set([...htmlVariables, ...textVariables])];

    const html = renderSignatureText(version.htmlContent, htmlVariables, ctx);
    const text = renderSignatureText(version.plainTextContent, textVariables, ctx);

    return {
      htmlContent: version.htmlContent,
      renderedHtml: html.rendered,
      plainTextContent: version.plainTextContent,
      renderedPlainText: text.rendered,
      variables: allVariables,
      usesRealSenderData: html.usesRealSenderData || text.usesRealSenderData,
    };
  }

  /**
   * Sends the active signature to an arbitrary recipient through the
   * mailbox's own SMTP config. Never touches campaign/step state (there
   * is none yet), never marked as "delivered" — only that SMTP accepted
   * it, per request section 13.
   */
  async sendTest(
    organizationId: string,
    mailboxId: string,
    to: string,
    actorId: string,
  ): Promise<SendTestSignatureResult> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    if (!mailbox.smtp) {
      throw new ConflictException(
        'Esta cuenta está vinculada por token del servidor motor; el envío de prueba mediante SMTP local no está disponible para este tipo de cuenta.',
      );
    }
    const signature = await this.getOwnedSignatureByMailbox(mailboxId);
    const version = await this.getActiveVersion(signature);

    const ctx = await this.buildRenderContext(organizationId, mailbox);
    const htmlVariables = extractTemplateVariables(version.htmlContent);
    const textVariables = extractTemplateVariables(version.plainTextContent);
    const html = renderSignatureText(version.htmlContent, htmlVariables, ctx).rendered;
    const text = renderSignatureText(version.plainTextContent, textVariables, ctx).rendered;

    const result = await this.engineClient.sendMail({
      mailboxEmail: mailbox.email,
      smtp: {
        host: mailbox.smtp.host,
        port: mailbox.smtp.port,
        encryption: mailbox.smtp.encryption,
        username: mailbox.smtp.username,
        password: this.secrets.decrypt(mailbox.smtp.secretCiphertext),
        verifyCertificate: mailbox.smtp.verifyCertificate,
      },
      fromName: mailbox.fromName,
      to,
      subject: 'Prueba de firma',
      html,
      text,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'signature.test_send',
      entityType: 'Signature',
      entityId: signature.id,
      // Never the recipient address or content — just the outcome.
      metadata: { accepted: result.accepted, errorCode: result.errorCode ?? null },
    });

    return {
      accepted: result.accepted,
      message: result.accepted
        ? 'Correo de prueba enviado correctamente.'
        : `El servidor SMTP no aceptó el mensaje (${result.errorCode ?? 'error desconocido'}).`,
    };
  }

  /**
   * Self-service surface for /me/mailboxes/:id/signature — an executive
   * only holds `signatures.update` (no `.create`), so this decides
   * create-vs-update itself instead of exposing two endpoints; either way
   * it 404s (never 403) unless the mailbox is actually assigned to this
   * user, enforced here rather than trusted to the frontend alone.
   */
  async saveForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
    htmlContent: string,
    plainTextContent: string | undefined,
    actorId: string,
  ): Promise<SignatureSummary> {
    await this.requireAssignedMailbox(userId, mailboxId);
    const existing = await this.signatures.findByMailbox(mailboxId);
    if (existing) {
      return this.update(organizationId, mailboxId, htmlContent, plainTextContent, actorId);
    }
    return this.create(organizationId, mailboxId, htmlContent, plainTextContent, actorId);
  }

  async getByMailboxForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
  ): Promise<SignatureSummary> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.getByMailbox(organizationId, mailboxId);
  }

  async previewForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
  ): Promise<SignaturePreview> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.preview(organizationId, mailboxId);
  }

  async sendTestForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
    to: string,
    actorId: string,
  ): Promise<SendTestSignatureResult> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.sendTest(organizationId, mailboxId, to, actorId);
  }

  /** Same 404-not-403 rule as MailboxesService's own assignment check. */
  private async requireAssignedMailbox(userId: string, mailboxId: string): Promise<void> {
    const userAssignments = await this.assignments.findByUser(userId);
    if (!userAssignments.some((assignment) => assignment.mailboxId === mailboxId)) {
      throw new NotFoundException('Mailbox not found.');
    }
  }

  private buildContent(
    htmlContent: string,
    plainTextContent: string | undefined,
  ): { htmlContent: string; plainTextContent: string } {
    const sanitized = this.sanitizer.sanitize(htmlContent);
    return {
      htmlContent: sanitized,
      plainTextContent: plainTextContent?.trim() || htmlToPlainText(sanitized),
    };
  }

  private async getActiveVersion(signature: Signature): Promise<SignatureVersion> {
    if (!signature.activeVersionId) {
      throw new NotFoundException('This mailbox has no active signature version.');
    }
    const version = await this.versions.findById(signature.activeVersionId);
    if (!version) {
      throw new NotFoundException('Signature version not found.');
    }
    return version;
  }

  /**
   * Prefers the mailbox's PRIMARY assignee; falls back to any other
   * assignee if there's no primary yet; falls back to a generic labeled
   * example when nobody is assigned at all (see request section 10).
   */
  private async buildRenderContext(
    organizationId: string,
    mailbox: Mailbox,
  ): Promise<SignatureRenderContext> {
    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    const mailboxAssignments = await this.assignments.findByMailbox(mailbox.id);
    const primary = mailboxAssignments.find((assignment) => assignment.role === 'PRIMARY');
    const chosen = primary ?? mailboxAssignments[0];

    let sender: User | null = null;
    if (chosen) {
      sender = await this.users.findById(chosen.userId);
    }

    return { mailbox, organization, sender };
  }

  /** Same 404-not-403 rule as UsersService — see its comment for why. */
  private async getOwnedMailbox(organizationId: string, mailboxId: string): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }
    return mailbox;
  }

  private async getOwnedSignatureByMailbox(mailboxId: string): Promise<Signature> {
    const signature = await this.signatures.findByMailbox(mailboxId);
    if (!signature) {
      throw new NotFoundException('This mailbox has no signature yet.');
    }
    return signature;
  }

  private toSummary(signature: Signature, versions: SignatureVersion[]): SignatureSummary {
    const versionSummaries = versions
      .slice()
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((version) => this.toVersionSummary(version, signature.activeVersionId));

    const activeVersion = versionSummaries.find((version) => version.isActive) ?? null;

    return {
      id: signature.id,
      mailboxId: signature.mailboxId,
      status: signature.status,
      activeVersion,
      versions: versionSummaries,
    };
  }

  private toVersionSummary(
    version: SignatureVersion,
    activeVersionId: string | null,
  ): SignatureVersionSummary {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      htmlContent: version.htmlContent,
      plainTextContent: version.plainTextContent,
      variables: [
        ...new Set([
          ...extractTemplateVariables(version.htmlContent),
          ...extractTemplateVariables(version.plainTextContent),
        ]),
      ],
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      isActive: version.id === activeVersionId,
    };
  }
}
