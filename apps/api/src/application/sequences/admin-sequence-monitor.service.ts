import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmail } from '../../domain/scheduled-email/scheduled-email.entity';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import {
  AdminSequenceDetail,
  AdminSequenceEvent,
  AdminSequenceListFilter,
  AdminSequenceListRow,
  AdminSequenceResults,
  AdminSequenceStepContent,
} from './admin-sequence-monitor.types';

const STOPPED_STATUSES = new Set(['REMOVED', 'UNSUBSCRIBED', 'COMPLETED_MANUALLY']);
const REASSIGN_ACTIONS: Record<string, string> = {
  'sequence.create': 'Secuencia creada',
  'sequence.create_wizard': 'Secuencia creada (asistente)',
  'sequence.update': 'Configuración editada',
  'sequence.change_account': 'Cuenta remitente cambiada',
  'sequence.pause': 'Secuencia pausada',
  'sequence.resume': 'Secuencia reanudada',
  'sequence.archive': 'Secuencia archivada',
  'sequence.restore': 'Secuencia restaurada',
  'sequence.delete': 'Secuencia eliminada',
  'sequence.reassign_executive': 'Ejecutivo responsable reasignado',
  'sequence.cancel_pending_sends': 'Envíos futuros cancelados',
};

/**
 * Spec §4 — the admin's global "todas las secuencias" panel. Stats are
 * computed live from SequenceContact/ScheduledEmail (already-persisted,
 * real telemetry) rather than a parallel counters table, so they can never
 * drift out of sync with the underlying rows. Supporting lookups
 * (sequences/contacts/emails/users/mailboxes/clients) are each fetched
 * ONCE per call and grouped in-memory, mirroring AdminClientsService's
 * "avoid N+1 across every row" approach.
 */
@Injectable()
export class AdminSequenceMonitorService {
  constructor(
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly scheduling: SchedulingService,
  ) {}

  async list(organizationId: string, filter: AdminSequenceListFilter = {}): Promise<AdminSequenceListRow[]> {
    let sequences = await this.sequences.findAllByOrganization(organizationId);

    if (filter.executiveId) sequences = sequences.filter((s) => s.executiveId === filter.executiveId);
    if (filter.clientId) sequences = sequences.filter((s) => s.clientId === filter.clientId);
    if (filter.mailboxId) sequences = sequences.filter((s) => s.mailboxId === filter.mailboxId);
    if (filter.status) sequences = sequences.filter((s) => s.status === filter.status);
    if (filter.activeOnly === true) sequences = sequences.filter((s) => s.status !== 'ARCHIVED');
    if (filter.activeOnly === false) sequences = sequences.filter((s) => s.status === 'ARCHIVED');
    if (filter.createdFrom) sequences = sequences.filter((s) => s.createdAt >= new Date(filter.createdFrom!));
    if (filter.createdTo) sequences = sequences.filter((s) => s.createdAt <= new Date(filter.createdTo!));
    if (filter.startedFrom) {
      sequences = sequences.filter((s) => !!s.effectiveStartAt && s.effectiveStartAt >= new Date(filter.startedFrom!));
    }
    if (filter.startedTo) {
      sequences = sequences.filter((s) => !!s.effectiveStartAt && s.effectiveStartAt <= new Date(filter.startedTo!));
    }

    const [allContacts, allEmails, allUsers, allMailboxes, allClients] = await Promise.all([
      this.sequenceContacts.findAllByOrganization(organizationId),
      this.scheduledEmails.findAll(organizationId),
      this.users.findAll(organizationId),
      this.mailboxes.findAll(organizationId),
      this.managedClients.findAll(organizationId),
    ]);

    const contactsBySequence = groupBy(allContacts, (c) => c.sequenceId);
    const emailsBySequence = groupBy(allEmails, (e) => e.sequenceId);
    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const mailboxById = new Map(allMailboxes.map((m) => [m.id, m]));
    const clientById = new Map(allClients.map((c) => [c.id, c]));

    const rows: AdminSequenceListRow[] = [];
    for (const sequence of sequences) {
      const sequenceSteps = await this.steps.findBySequence(sequence.id);
      const contacts = contactsBySequence.get(sequence.id) ?? [];
      const emails = emailsBySequence.get(sequence.id) ?? [];
      const stats = computeStats(sequenceSteps, contacts, emails);

      const executive = userById.get(sequence.executiveId);
      const creator = userById.get(sequence.createdBy);
      const mailbox = sequence.mailboxId ? mailboxById.get(sequence.mailboxId) : null;
      const client = sequence.clientId ? clientById.get(sequence.clientId) : null;

      rows.push({
        id: sequence.id,
        name: sequence.name,
        status: sequence.status,
        publishStatus: sequence.publishStatus,
        clientId: sequence.clientId,
        clientName: client?.name ?? null,
        mailboxId: sequence.mailboxId,
        mailboxEmail: mailbox?.email ?? null,
        executiveId: sequence.executiveId,
        executiveName: executive ? fullName(executive) : '—',
        createdBy: sequence.createdBy,
        createdByName: creator ? fullName(creator) : '—',
        createdAt: sequence.createdAt,
        effectiveStartAt: sequence.effectiveStartAt,
        ...stats,
      });
    }

    if (!filter.search) return rows;
    const needle = filter.search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.clientName ?? '').toLowerCase().includes(needle) ||
        row.executiveName.toLowerCase().includes(needle) ||
        (row.mailboxEmail ?? '').toLowerCase().includes(needle),
    );
  }

  async getDetail(organizationId: string, sequenceId: string): Promise<AdminSequenceDetail> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    const [sequenceSteps, contacts, emails, auditEntries] = await Promise.all([
      this.steps.findBySequence(sequence.id),
      this.sequenceContacts.findBySequence(organizationId, sequence.id),
      this.scheduledEmails.findAll(organizationId, { sequenceId: sequence.id }),
      this.auditLogs.findAll(organizationId, { entityType: 'Sequence', entityId: sequence.id }),
    ]);

    const [executive, creator, mailbox, client] = await Promise.all([
      this.users.findById(sequence.executiveId),
      this.users.findById(sequence.createdBy),
      sequence.mailboxId ? this.mailboxes.findById(sequence.mailboxId) : Promise.resolve(null),
      sequence.clientId ? this.managedClients.findById(sequence.clientId) : Promise.resolve(null),
    ]);

    const stats = computeStats(sequenceSteps, contacts, emails);
    const results: AdminSequenceResults = {
      prospectCount: stats.prospectCount,
      pendingCount: contacts.filter((c) => c.status === 'PENDING' || c.status === 'ACTIVE' || c.status === 'SCHEDULED')
        .length,
      sentStep1: stats.sentStep1,
      sentStep2: stats.sentStep2,
      sentStep3: stats.sentStep3,
      repliedCount: stats.repliedCount,
      bouncedCount: stats.bouncedCount,
      stoppedCount: stats.stoppedCount,
      errorCount: stats.errorCount,
    };

    const events = buildEventHistory(auditEntries, contacts);
    const steps = buildStepContents(sequenceSteps, emails);

    return {
      id: sequence.id,
      name: sequence.name,
      status: sequence.status,
      publishStatus: sequence.publishStatus,
      timezone: sequence.timezone,
      managementDate: sequence.managementDate,
      effectiveStartAt: sequence.effectiveStartAt,
      createdAt: sequence.createdAt,
      clientId: sequence.clientId,
      clientName: client?.name ?? null,
      mailboxId: sequence.mailboxId,
      mailboxEmail: mailbox?.email ?? null,
      executiveId: sequence.executiveId,
      executiveName: executive ? fullName(executive) : '—',
      createdBy: sequence.createdBy,
      createdByName: creator ? fullName(creator) : '—',
      results,
      events,
      steps,
    };
  }

  /** Spec §4.5 — cancels every not-yet-sent job without archiving the sequence (distinct from "archivar"). */
  async cancelPendingSends(organizationId: string, sequenceId: string, actorId: string): Promise<number> {
    await this.getOwnedSequence(organizationId, sequenceId);
    const cancelledJobs = await this.scheduling.cancelFutureJobsForSequence(
      organizationId,
      sequenceId,
      'Cancelado manualmente por el administrador.',
    );

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.cancel_pending_sends',
      entityType: 'Sequence',
      entityId: sequenceId,
      metadata: { cancelledJobs },
    });

    return cancelledJobs;
  }

  private async getOwnedSequence(organizationId: string, sequenceId: string): Promise<Sequence> {
    const sequence = await this.sequences.findById(sequenceId);
    if (!sequence || sequence.organizationId !== organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    return sequence;
  }
}

function groupBy<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

function computeStats(
  sequenceSteps: SequenceStep[],
  contacts: SequenceContact[],
  emails: ScheduledEmail[],
): {
  prospectCount: number;
  sentStep1: number;
  sentStep2: number;
  sentStep3: number;
  repliedCount: number;
  bouncedCount: number;
  stoppedCount: number;
  errorCount: number;
  lastActivityAt: Date | null;
} {
  const positionByStepId = new Map(sequenceSteps.map((s) => [s.id, s.position]));
  const sentByPosition = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
  let errorCount = 0;
  let lastActivityAt: Date | null = null;

  for (const email of emails) {
    const position = positionByStepId.get(email.sequenceStepId);
    if (email.status === 'SENT' && position && position in sentByPosition) {
      sentByPosition[position] += 1;
      if (email.sentAt && (!lastActivityAt || email.sentAt > lastActivityAt)) lastActivityAt = email.sentAt;
    }
    if (email.status === 'FAILED') errorCount += 1;
  }

  let repliedCount = 0;
  let bouncedCount = 0;
  let stoppedCount = 0;
  for (const contact of contacts) {
    if (contact.status === 'REPLIED') repliedCount += 1;
    if (contact.status === 'BOUNCED') bouncedCount += 1;
    if (STOPPED_STATUSES.has(contact.status)) stoppedCount += 1;
    if (contact.status === 'ERROR') errorCount += 1;
    for (const at of [contact.lastSentAt, contact.repliedAt, contact.stoppedAt, contact.completedAt]) {
      if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
    }
  }

  return {
    prospectCount: contacts.length,
    sentStep1: sentByPosition[1],
    sentStep2: sentByPosition[2],
    sentStep3: sentByPosition[3],
    repliedCount,
    bouncedCount,
    stoppedCount,
    errorCount,
    lastActivityAt,
  };
}

function buildEventHistory(
  auditEntries: { action: string; createdAt: Date; metadata: Record<string, unknown> }[],
  contacts: SequenceContact[],
): AdminSequenceEvent[] {
  const events: AdminSequenceEvent[] = [];

  for (const entry of auditEntries) {
    events.push({
      at: entry.createdAt,
      type: entry.action,
      description: REASSIGN_ACTIONS[entry.action] ?? entry.action,
    });
  }

  for (const contact of contacts) {
    if (contact.repliedAt) {
      events.push({ at: contact.repliedAt, type: 'contact.replied', description: 'Respuesta recibida de un prospecto' });
    }
    if (contact.stoppedAt) {
      events.push({
        at: contact.stoppedAt,
        type: 'contact.stopped',
        description: contact.stopReason
          ? `Prospecto detenido — ${contact.stopReason}`
          : 'Prospecto detenido',
      });
    }
    if (contact.completedAt) {
      events.push({ at: contact.completedAt, type: 'contact.completed', description: 'Prospecto completó la secuencia' });
    }
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Spec §4.4 — content must reflect what was actually sent, not the current
 * (possibly since-edited) draft. Each step's most recent SENT
 * ScheduledEmail carries an immutable snapshot (subjectSnapshot/
 * htmlBodySnapshot, frozen forever once set — see ScheduledEmail's own
 * comment); only falls back to the live step when nothing has sent yet.
 */
function buildStepContents(sequenceSteps: SequenceStep[], emails: ScheduledEmail[]): AdminSequenceStepContent[] {
  const latestSentByStepId = new Map<string, ScheduledEmail>();
  for (const email of emails) {
    if (email.status !== 'SENT' || !email.sentAt) continue;
    const current = latestSentByStepId.get(email.sequenceStepId);
    if (!current || (current.sentAt && email.sentAt > current.sentAt)) {
      latestSentByStepId.set(email.sequenceStepId, email);
    }
  }

  return [...sequenceSteps]
    .sort((a, b) => a.position - b.position)
    .map((step) => {
      const snapshot = latestSentByStepId.get(step.id);
      if (snapshot && snapshot.subjectSnapshot !== null && snapshot.htmlBodySnapshot !== null) {
        return {
          id: step.id,
          position: step.position,
          name: step.name,
          subject: snapshot.subjectSnapshot,
          htmlHeader: step.htmlHeader,
          htmlBody: snapshot.htmlBodySnapshot,
          isSentSnapshot: true,
        };
      }
      return {
        id: step.id,
        position: step.position,
        name: step.name,
        subject: step.subject,
        htmlHeader: step.htmlHeader,
        htmlBody: step.htmlBody,
        isSentSnapshot: false,
      };
    });
}
