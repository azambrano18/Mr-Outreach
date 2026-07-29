import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { DelayUnit, StepSendMode } from '../../domain/sequence/sequence-step.entity';
import { Sequence, SequenceSchedule, UpdateSequenceInput } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SequenceEligibilityService } from './sequence-eligibility.service';
import { SequenceStepsService } from './sequence-steps.service';
import { addDelay, computeEffectiveStart, generateSequenceName, SANTIAGO_TIMEZONE } from './sequence-timing.util';
import {
  CreateSequencePayload,
  CreateWizardSequenceForExecutivePayload,
  CreateWizardSequencePayload,
  ReadinessCheck,
  ReassignExecutivePayload,
  SchedulePreview,
  SenderAccountInfo,
  SequenceDeletionResult,
  SequenceReadiness,
  SequenceSummary,
  UpdateSequencePayload,
} from './sequences.types';

/** §10-11 — fixed steps every wizard-created sequence gets automatically; never addable/removable/renameable/reorderable (enforced in `SequenceStepsService`). */
const FIXED_STEP_SPECS: Array<{ name: string; delayValue: number; delayUnit: DelayUnit; sendMode: StepSendMode }> = [
  { name: 'Enviados_1', delayValue: 0, delayUnit: 'DAYS', sendMode: 'NEW_THREAD' },
  { name: 'Enviados_2', delayValue: 5, delayUnit: 'BUSINESS_DAYS', sendMode: 'REPLY' },
  { name: 'Enviados_3', delayValue: 10, delayUnit: 'BUSINESS_DAYS', sendMode: 'REPLY' },
];

/** §11 — L-V 08:00-19:00 America/Santiago, the default sending window every wizard-created sequence loads with. */
const DEFAULT_WIZARD_SCHEDULE: SequenceSchedule = {
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  windows: [{ start: '08:00', end: '19:00' }],
};

@Injectable()
export class SequencesService {
  constructor(
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY)
    private readonly assignments: MailboxAssignmentRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY)
    private readonly signatureVersions: SignatureVersionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly clientExecutiveAssignments: ClientExecutiveAssignmentRepository,
    private readonly sequenceSteps: SequenceStepsService,
    private readonly eligibility: SequenceEligibilityService,
  ) {}

  async listForExecutive(organizationId: string, executiveId: string): Promise<SequenceSummary[]> {
    await this.requireOwnedActiveExecutive(organizationId, executiveId);
    const rows = await this.sequences.findByExecutive(organizationId, executiveId);
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  async getById(organizationId: string, sequenceId: string): Promise<SequenceSummary> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    return this.toSummary(sequence);
  }

  /**
   * Fase 1.5 finding: `CreateSequencePayload` carries no `clientId` at all
   * (the sequence starts unassociated with any client) — the CRM
   * eligibility gate doesn't apply here for lack of anything to check
   * against. It applies once a client is attached, via the wizard paths
   * below, which are the only ones that take a `clientId`.
   */
  async create(
    organizationId: string,
    executiveId: string,
    input: CreateSequencePayload,
    actorId: string,
  ): Promise<SequenceSummary> {
    await this.requireOwnedActiveExecutive(organizationId, executiveId);

    const sequence = await this.sequences.create({
      organizationId,
      executiveId,
      name: input.name,
      description: input.description ?? null,
      timezone: input.timezone,
      createdBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.create',
      entityType: 'Sequence',
      entityId: sequence.id,
      metadata: { executiveId, name: sequence.name },
    });

    return this.toSummary(sequence);
  }

  /**
   * §5/§10-11 — the wizard's "Configuración general" step, all in one call: picks the client +
   * sender account (both must already be assigned to this executive) and the management date,
   * generates the locked `Gestión_DDMMYYYY` name, and auto-creates the three fixed steps.
   */
  async createFromWizard(
    organizationId: string,
    executiveId: string,
    input: CreateWizardSequencePayload,
    actorId: string,
  ): Promise<SequenceSummary> {
    await this.requireOwnedActiveExecutive(organizationId, executiveId);
    // Fase 2 — centralized eligibility (client active + CRM active +
    // executive assigned to client); no PostgreSQL write happens here.
    await this.eligibility.verify({ organizationId, clientId: input.clientId, executiveId });
    const mailbox = await this.requireAssignedOperationalMailbox(organizationId, executiveId, input.mailboxId);
    if (mailbox.clientId !== input.clientId) {
      throw new BadRequestException('La cuenta de correo seleccionada no pertenece al cliente indicado.');
    }

    return this.buildWizardSequence(organizationId, executiveId, mailbox, input.managementDate, actorId, {
      clientId: input.clientId,
      mailboxId: input.mailboxId,
    });
  }

  /**
   * Admin equivalent of createFromWizard (spec §3): the admin picks any
   * ACTIVE executive, who must already be assigned to the chosen client
   * (visibility) — the sender account, unlike the self-service path, is
   * NOT required to already be assigned to that executive (operation):
   * if it isn't, the admin must explicitly authorize the assignment via
   * `authorizeMailboxAssignment`, which grants it as part of this same
   * call rather than silently failing or silently auto-granting it.
   */
  async createFromWizardForExecutive(
    organizationId: string,
    executiveId: string,
    input: CreateWizardSequenceForExecutivePayload,
    actorId: string,
  ): Promise<SequenceSummary> {
    await this.requireOwnedActiveExecutive(organizationId, executiveId);
    // Fase 2 — centralized eligibility: client operationally active + CRM
    // active + executive assigned to client + domain active + mailbox
    // active/connected/provisioned/belongs to domain+client. Pure
    // validation — no PostgreSQL write happens inside `verify()`.
    const eligible = await this.eligibility.verify({
      organizationId,
      clientId: input.clientId,
      executiveId,
      domainId: input.domainId,
      mailboxId: input.mailboxId,
    });
    const mailbox = eligible.mailbox as Mailbox;

    const mailboxAssignments = await this.assignments.findByMailbox(mailbox.id);
    if (!eligible.mailboxAlreadyAssigned) {
      if (!input.authorizeMailboxAssignment) {
        throw new BadRequestException(
          'La cuenta de correo no está asignada al ejecutivo. Autoriza la asignación para continuar.',
        );
      }
      await this.assignments.upsert({
        organizationId,
        mailboxId: mailbox.id,
        userId: executiveId,
        role: mailboxAssignments.length === 0 ? 'PRIMARY' : 'SECONDARY',
        assignedBy: actorId,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.assign',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: { userId: executiveId, viaSequenceWizard: true },
      });
    }

    return this.buildWizardSequence(organizationId, executiveId, mailbox, input.managementDate, actorId, {
      clientId: input.clientId,
      mailboxId: input.mailboxId,
    });
  }

  /**
   * Reassigns which executive operationally owns a sequence (spec §3.1) —
   * `createdBy` never changes, only `executiveId`. The new executive must
   * be ACTIVE and assigned to the sequence's client, same as at creation.
   */
  async reassignExecutive(
    organizationId: string,
    sequenceId: string,
    input: ReassignExecutivePayload,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    await this.requireOwnedActiveExecutive(organizationId, input.executiveId);
    if (existing.clientId) {
      await this.requireExecutiveAssignedToClient(input.executiveId, existing.clientId);
    }

    const previousExecutiveId = existing.executiveId;
    const updated = await this.sequences.update(existing.id, {
      executiveId: input.executiveId,
      updatedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.reassign_executive',
      entityType: 'Sequence',
      entityId: sequenceId,
      metadata: { previousExecutiveId, newExecutiveId: input.executiveId, reason: input.reason ?? null },
    });

    return this.toSummary(updated);
  }

  /** Shared tail of createFromWizard/createFromWizardForExecutive: the sequence row + its 3 fixed steps. */
  private async buildWizardSequence(
    organizationId: string,
    executiveId: string,
    mailbox: Mailbox,
    managementDate: string,
    actorId: string,
    auditContext: { clientId: string; mailboxId: string },
  ): Promise<SequenceSummary> {
    const sequence = await this.sequences.create({
      organizationId,
      executiveId,
      name: generateSequenceName(managementDate),
      timezone: SANTIAGO_TIMEZONE,
      createdBy: actorId,
      managementDate,
      stepPolicy: 'FIXED_3',
      schedule: DEFAULT_WIZARD_SCHEDULE,
    });
    await this.sequences.update(sequence.id, {
      mailboxId: mailbox.id,
      clientId: mailbox.clientId,
      updatedBy: actorId,
    });

    for (const spec of FIXED_STEP_SPECS) {
      await this.sequenceSteps.create(
        organizationId,
        sequence.id,
        {
          name: spec.name,
          subject: '',
          htmlBody: '',
          delayValue: spec.delayValue,
          delayUnit: spec.delayUnit,
          sendMode: spec.sendMode,
        },
        actorId,
      );
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.create_wizard',
      entityType: 'Sequence',
      entityId: sequence.id,
      metadata: { executiveId, ...auditContext, managementDate },
    });

    return this.getById(organizationId, sequence.id);
  }

  async update(
    organizationId: string,
    sequenceId: string,
    input: UpdateSequencePayload,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);

    const patch: UpdateSequenceInput = { updatedBy: actorId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.schedule !== undefined) patch.schedule = input.schedule;

    // Changing the sender account re-validates it from scratch and never
    // carries over anything from the previous one (section 4: "no
    // conservar la firma anterior" — there's nothing to carry over since
    // the signature is never stored on the sequence, only looked up live
    // via mailboxId each time).
    if (input.mailboxId !== undefined) {
      if (input.mailboxId === null) {
        patch.mailboxId = null;
        patch.clientId = null;
      } else {
        const mailbox = await this.requireAssignedOperationalMailbox(
          organizationId,
          existing.executiveId,
          input.mailboxId,
        );
        patch.mailboxId = input.mailboxId;
        // Deduced from the sender account, never set independently — see
        // the Sequence.clientId doc comment.
        patch.clientId = mailbox.clientId;
      }
    }

    const updated = await this.sequences.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: input.mailboxId !== undefined ? 'sequence.change_account' : 'sequence.update',
      entityType: 'Sequence',
      entityId: sequenceId,
    });

    return this.toSummary(updated);
  }

  async duplicate(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const original = await this.getOwnedSequence(organizationId, sequenceId);
    const originalSteps = await this.steps.findBySequence(original.id);

    const copy = await this.sequences.create({
      organizationId,
      executiveId: original.executiveId,
      name: `${original.name} (copia)`,
      description: original.description ?? undefined,
      timezone: original.timezone,
      createdBy: actorId,
    });
    if (original.mailboxId) {
      await this.sequences.update(copy.id, { mailboxId: original.mailboxId, updatedBy: actorId });
    }

    for (const step of originalSteps) {
      await this.steps.create({
        organizationId,
        sequenceId: copy.id,
        position: step.position,
        name: step.name,
        subject: step.subject,
        preheader: step.preheader,
        htmlBody: step.htmlBody,
        plainTextBody: step.plainTextBody,
        delayValue: step.delayValue,
        delayUnit: step.delayUnit,
        sendMode: step.sendMode,
        createdBy: actorId,
      });
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.duplicate',
      entityType: 'Sequence',
      entityId: copy.id,
      metadata: { sourceSequenceId: sequenceId },
    });

    return this.getById(organizationId, copy.id);
  }

  async pause(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft sequence can be paused.');
    }
    return this.setStatus(organizationId, existing, 'PAUSED', 'sequence.pause', actorId);
  }

  async resume(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    if (existing.status !== 'PAUSED') {
      throw new BadRequestException('Only a paused sequence can be resumed.');
    }
    return this.setStatus(organizationId, existing, 'DRAFT', 'sequence.resume', actorId);
  }

  async archive(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Sequence is already archived.');
    }
    return this.setStatus(organizationId, existing, 'ARCHIVED', 'sequence.archive', actorId);
  }

  async restore(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    if (existing.status !== 'ARCHIVED') {
      throw new BadRequestException('Only an archived sequence can be restored.');
    }
    return this.setStatus(organizationId, existing, 'DRAFT', 'sequence.restore', actorId);
  }

  /**
   * Soft delete. There is no ACTIVE state or scheduler/worker in this
   * phase (see the entity file's comment), so "pause future sends and
   * cancel pending jobs" — the rule for an active sequence — has nothing
   * real to do beyond forcing the status to ARCHIVED; `cancelledJobs` is
   * always 0 rather than a faked number. Sent messages, replies, bounces,
   * snapshots and audit history are never touched — this only sets
   * `deletedAt` (and `status`) on the Sequence row itself, which is also
   * what makes a second call on an already-deleted sequence a clean 404
   * (findById filters out `deletedAt` rows) instead of a duplicate
   * side-effect — the idempotency the request asked for.
   */
  async remove(
    organizationId: string,
    sequenceId: string,
    actorId: string,
  ): Promise<SequenceDeletionResult> {
    const existing = await this.getOwnedSequence(organizationId, sequenceId);
    const deletedAt = new Date();

    await this.sequences.update(existing.id, {
      status: 'ARCHIVED',
      deletedAt,
      updatedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.delete',
      entityType: 'Sequence',
      entityId: sequenceId,
      metadata: { previousStatus: existing.status, cancelledJobs: 0 },
    });

    return {
      id: sequenceId,
      deletedAt: deletedAt.toISOString(),
      previousStatus: existing.status,
      cancelledJobs: 0,
    };
  }

  /**
   * Checks what this phase is actually able to validate (account + steps)
   * — prospects/calendar are reported as PENDING_FEATURE, never faked as
   * passing or failing, since neither exists yet (see README > "Fase 10").
   */
  async getReadiness(organizationId: string, sequenceId: string): Promise<SequenceReadiness> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    const accountIssues: string[] = [];

    if (!sequence.mailboxId) {
      accountIssues.push('No se ha seleccionado una cuenta remitente.');
    } else {
      const mailbox = await this.mailboxes.findById(sequence.mailboxId);
      if (!mailbox || mailbox.organizationId !== organizationId) {
        accountIssues.push('La cuenta remitente seleccionada ya no existe.');
      } else {
        const info = await this.buildSenderAccountInfo(mailbox);
        accountIssues.push(...info.issues);
      }
    }

    const steps = await this.steps.findBySequence(sequence.id);
    const stepIssues: string[] = [];
    if (steps.length === 0) {
      stepIssues.push('La secuencia no tiene ningún step.');
    }
    for (const step of steps) {
      if (!step.subject.trim()) stepIssues.push(`El step "${step.name}" no tiene asunto.`);
      if (!step.htmlBody.trim()) stepIssues.push(`El step "${step.name}" no tiene contenido.`);
    }

    const account: ReadinessCheck = { ok: accountIssues.length === 0, issues: accountIssues };
    const stepsCheck: ReadinessCheck = { ok: stepIssues.length === 0, issues: stepIssues };

    return {
      account,
      steps: stepsCheck,
      prospects: {
        status: 'PENDING_FEATURE',
        message: 'La incorporación de prospectos todavía no está implementada.',
      },
      calendar: {
        status: 'PENDING_FEATURE',
        message: 'El calendario de envío todavía no está implementado.',
      },
      overallReady: account.ok && stepsCheck.ok,
    };
  }

  /**
   * §7 — "Envío estimado" shown under each step card, recalculated live as the executive edits
   * management date, delay, window, or enabled days. Chains each step's `addDelay` off the
   * PREVIOUS step's own estimate (never off "now"), mirroring exactly how a real send would be
   * computed once the previous step has actually gone out (see SchedulingService.createBatch).
   */
  async previewSchedule(organizationId: string, sequenceId: string): Promise<SchedulePreview> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    const steps = (await this.steps.findBySequence(sequence.id)).sort((a, b) => a.position - b.position);

    const effectiveStartAt = sequence.managementDate
      ? computeEffectiveStart(sequence.managementDate, new Date(), sequence.schedule, sequence.timezone)
      : new Date();

    let cursor = effectiveStartAt;
    const stepPreviews = steps.map((step) => {
      const estimatedAt = addDelay(cursor, step.delayValue, step.delayUnit, sequence.timezone);
      cursor = estimatedAt;
      return { stepId: step.id, position: step.position, name: step.name, estimatedAt: estimatedAt.toISOString() };
    });

    return { effectiveStartAt: effectiveStartAt.toISOString(), steps: stepPreviews };
  }

  /** Used by SequenceStepsService for the auto-signature preview/send-test — never selectable, only looked up. */
  async requireOwnedSequence(organizationId: string, sequenceId: string): Promise<Sequence> {
    return this.getOwnedSequence(organizationId, sequenceId);
  }

  /**
   * Self-service ownership check for the /me/sequences routes — same
   * 404-not-403 rule as getOwnedSequence, but also 404s when the sequence
   * belongs to a different executive (an executive must never learn
   * whether a colleague's sequence id exists).
   */
  async requireOwnedByExecutive(
    organizationId: string,
    sequenceId: string,
    executiveId: string,
  ): Promise<SequenceSummary> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    if (sequence.executiveId !== executiveId) {
      throw new NotFoundException('Sequence not found.');
    }
    return this.toSummary(sequence);
  }

  async buildSenderAccountInfo(mailbox: Mailbox): Promise<SenderAccountInfo> {
    const issues: string[] = [];
    if (mailbox.status !== 'ACTIVE') {
      issues.push('La cuenta no está activa.');
    }
    if (mailbox.connectionStatus !== 'CONNECTED') {
      issues.push('La cuenta no tiene una conexión IMAP/SMTP validada.');
    }

    const signature = await this.signatures.findByMailbox(mailbox.id);
    let hasActiveSignature = false;
    let signatureLabel: string | null = null;
    if (signature && signature.status === 'ACTIVE' && signature.activeVersionId) {
      hasActiveSignature = true;
      signatureLabel = `Firma activa (versión ${(await this.signatureVersions.findById(signature.activeVersionId))?.versionNumber ?? '—'})`;
    } else {
      issues.push(
        'La cuenta seleccionada no tiene una firma activa. Configura la firma antes de activar esta secuencia.',
      );
    }

    return {
      mailboxId: mailbox.id,
      email: mailbox.email,
      fromName: mailbox.fromName,
      dailyLimit: null,
      hasActiveSignature,
      signatureLabel,
      operational: mailbox.status === 'ACTIVE' && mailbox.connectionStatus === 'CONNECTED',
      issues,
    };
  }

  private async setStatus(
    organizationId: string,
    sequence: Sequence,
    status: Sequence['status'],
    action: string,
    actorId: string,
  ): Promise<SequenceSummary> {
    const updated = await this.sequences.update(sequence.id, { status, updatedBy: actorId });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action,
      entityType: 'Sequence',
      entityId: sequence.id,
    });
    return this.toSummary(updated);
  }

  private async requireAssignedOperationalMailbox(
    organizationId: string,
    executiveId: string,
    mailboxId: string,
  ): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new BadRequestException('Invalid mailbox id.');
    }

    const assignments = await this.assignments.findByMailbox(mailboxId);
    const isAssigned = assignments.some((assignment) => assignment.userId === executiveId);
    if (!isAssigned) {
      throw new BadRequestException(
        'Solo se pueden seleccionar cuentas asignadas al ejecutivo responsable.',
      );
    }
    return mailbox;
  }

  /** Spec §3 — "El ejecutivo debe estar asignado al cliente seleccionado" (visibility, distinct from mailbox/operational assignment). */
  private async requireExecutiveAssignedToClient(executiveId: string, clientId: string): Promise<void> {
    const clientAssignments = await this.clientExecutiveAssignments.findByUser(executiveId);
    const isAssigned = clientAssignments.some((assignment) => assignment.clientId === clientId);
    if (!isAssigned) {
      throw new BadRequestException('El ejecutivo no está asignado a este cliente.');
    }
  }

  private async requireOwnedActiveExecutive(
    organizationId: string,
    executiveId: string,
  ): Promise<User> {
    const user = await this.users.findById(executiveId);
    if (!user || user.organizationId !== organizationId) {
      throw new NotFoundException('Executive not found.');
    }
    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('Executive is not active.');
    }
    return user;
  }

  /** Same 404-not-403 rule as every other resource in this API. */
  private async getOwnedSequence(organizationId: string, sequenceId: string): Promise<Sequence> {
    const sequence = await this.sequences.findById(sequenceId);
    if (!sequence || sequence.organizationId !== organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    return sequence;
  }

  private async toSummary(sequence: Sequence): Promise<SequenceSummary> {
    const [steps, mailbox] = await Promise.all([
      this.steps.findBySequence(sequence.id),
      sequence.mailboxId ? this.mailboxes.findById(sequence.mailboxId) : Promise.resolve(null),
    ]);

    // Frozen at the moment of a real publish (SequencePublishService); before that, a live preview
    // so the wizard's "Revisión"/"Programación" steps can show §6's "fecha y hora efectiva de inicio"
    // ahead of time, per §20.
    const effectiveStartAt =
      sequence.effectiveStartAt ??
      (sequence.managementDate
        ? computeEffectiveStart(sequence.managementDate, new Date(), sequence.schedule, sequence.timezone)
        : null);

    return {
      id: sequence.id,
      organizationId: sequence.organizationId,
      executiveId: sequence.executiveId,
      createdBy: sequence.createdBy,
      mailboxId: sequence.mailboxId,
      mailboxEmail: mailbox?.email ?? null,
      name: sequence.name,
      description: sequence.description,
      status: sequence.status,
      timezone: sequence.timezone,
      schedule: sequence.schedule,
      policies: sequence.policies,
      managementDate: sequence.managementDate,
      stepPolicy: sequence.stepPolicy,
      publishStatus: sequence.publishStatus,
      effectiveStartAt,
      sequenceVersion: sequence.sequenceVersion,
      lastPublishedAt: sequence.lastPublishedAt,
      lastPublishCommandId: sequence.lastPublishCommandId,
      stepCount: steps.length,
      createdAt: sequence.createdAt,
      updatedAt: sequence.updatedAt,
    };
  }
}
