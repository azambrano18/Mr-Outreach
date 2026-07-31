import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import {
  SEQUENCE_EXECUTION_MOTOR_PORT,
  SequenceExecutionMotorPort,
} from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import {
  AUDIT_LOG_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { buildIdempotencyStorageKey } from '../idempotency/idempotent-operation.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { calendarDateInTimezone, generateSequenceName, SANTIAGO_TIMEZONE } from '../sequences/sequence-timing.util';
import { ExecutiveMailboxEligibilityService } from '../sequence-templates/executive-mailbox-eligibility.service';
import { ProspectIdentityResolver } from '../prospect-imports/prospect-identity-resolver.service';
import { ProspectImportsService } from '../prospect-imports/prospect-imports.service';
import { SequenceExecutionsService } from './sequence-executions.service';
import { SequenceExecutionSummary } from './sequence-executions.types';

/**
 * §1/§11 — a fresh submission may only start from one of these; everything
 * else means "already submitted or terminal" and gets a 409. A previous
 * REJECTED/FAILED attempt is deliberately NOT blocked — the executive may
 * fix whatever caused it (e.g. reconnect the account) and try again, same
 * as before this change.
 */
const FRESH_SUBMIT_BLOCKED_STATUSES: SequenceExecutionStatus[] = ['SUBMITTING', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'RUNNING', 'COMPLETED'];
/** §12 — these two mean "an attempt is already in flight or its outcome is unknown"; calling /start again on one of these is a RETRY, not a new submission. */
const RETRY_STATUSES: SequenceExecutionStatus[] = ['SUBMITTING', 'SUBMISSION_UNKNOWN'];

export interface StartSequenceExecutionInput {
  organizationId: string;
  executiveId: string;
  executionId: string;
  idempotencyKey: string;
  correlationId?: string;
}

/**
 * §1-7 — "Mr Outreach solo envía la base asociada al ID de la Plantilla."
 * All local business validation (mailbox eligibility, template ownership,
 * publication status, version acceptance, column mapping, valid-row
 * count) still runs exactly as before — only the payload actually sent to
 * the motor changed: `serverTemplateId` plus the normalized prospect
 * list, nothing else. No queue/dispatch/priority/worker instruction, no
 * technical owner, no initial step, no scheduled date ever leaves this
 * process.
 *
 * All pre-flight validation runs BEFORE the SUBMITTING claim, so a
 * validation failure never leaves the Gestión stuck mid-submission — it
 * simply stays DRAFT and the executive can fix the issue and press
 * "Iniciar gestión" again. Only the motor call itself is allowed to leave
 * the row in SUBMITTING/SUBMISSION_UNKNOWN (§12): if the motor is
 * unreachable or times out, Mr Outreach does not know whether the server
 * received the command, so it never re-creates a second remote Gestión —
 * a later call to this same method reuses the exact same idempotencyKey
 * that was already used for the in-flight attempt.
 */
@Injectable()
export class StartSequenceExecutionUseCase {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly templateVersions: SequenceTemplateVersionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_EXECUTION_MOTOR_PORT) private readonly motor: SequenceExecutionMotorPort,
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    private readonly executionsService: SequenceExecutionsService,
    private readonly eligibility: ExecutiveMailboxEligibilityService,
    private readonly prospectImports: ProspectImportsService,
    private readonly prospectIdentity: ProspectIdentityResolver,
    private readonly secrets: SecretEncryptionService,
  ) {}

  async execute(input: StartSequenceExecutionInput): Promise<SequenceExecutionSummary> {
    const execution = await this.executionsService.requireOwned(input.organizationId, input.executiveId, input.executionId);
    const isRetry = RETRY_STATUSES.includes(execution.status);

    if (!isRetry && FRESH_SUBMIT_BLOCKED_STATUSES.includes(execution.status)) {
      throw new ConflictException('Esta gestión ya fue enviada al servidor.');
    }

    // Pre-flight validation happens before any status mutation (see class doc comment).
    // §6 — Mr Outreach's own authorization rule: only an eligible, currently-assigned account may be used. Never sent to the server.
    await this.eligibility.requireEligible(input.organizationId, input.executiveId, execution.mailboxId);

    const version = await this.templateVersions.findById(execution.templateVersionId);
    if (!version || version.status !== 'ACCEPTED' || !version.serverTemplateId) {
      throw new ConflictException('La versión de plantilla de esta gestión ya no es válida.');
    }

    const importRecord = await this.prospectImports.getImportForExecution(execution.id);
    if (!importRecord || importRecord.status !== 'READY' || !importRecord.columnMapping) {
      throw new BadRequestException('Debes cargar y mapear una base de prospectos antes de iniciar la gestión.');
    }

    const validRows = await this.prospectImports.getValidRows(execution.id);
    if (validRows.length === 0) {
      throw new BadRequestException('No hay prospectos válidos para enviar.');
    }

    // §12 — a retry reuses the exact idempotencyKey already stored for the in-flight attempt, ignoring whatever key this call received, so the motor treats it as the same command.
    const idempotencyKey = isRetry && execution.lastSubmissionIdempotencyKey ? execution.lastSubmissionIdempotencyKey : input.idempotencyKey;
    const correlationId = input.correlationId ?? execution.id;
    // §5 — generated once from the real moment of the FIRST attempt, then kept stable across retries/resubmissions. Local only — never sent to the server.
    const name = execution.name ?? (await this.generateManagementName(input.organizationId, input.executiveId, new Date()));

    const requestedAt = new Date();
    // Fase "Comandos y eventos del flujo activo" — Alternativa A: durable
    // traceability layered on top of the existing SequenceExecution.status
    // state machine, which remains the actual concurrency-control mechanism
    // (conditionalUpdateStatus below) — this command row never replaces it.
    const commandStorageKey = buildIdempotencyStorageKey('sequence_execution.start', idempotencyKey);

    // ETAPA A — transacción local: reclama el estado SUBMITTING y crea (o
    // localiza, en un reintento) el IntegrationCommand REQUESTED, todo o
    // nada. El motor todavía no fue llamado.
    const commandRowId = await this.tx.run(async (ctx) => {
      if (!isRetry) {
        const claimed = await this.executions.conditionalUpdateStatus(
          execution.id,
          FRESH_SUBMIT_BLOCKED_STATUSES,
          'SUBMITTING',
          ctx,
        );
        if (claimed === 0) {
          throw new ConflictException('Esta gestión ya fue enviada al servidor.');
        }
      }
      await this.executions.update(execution.id, { name, lastSubmissionIdempotencyKey: idempotencyKey, requestedAt }, ctx);

      await this.audit.record(
        {
          organizationId: input.organizationId,
          actorId: input.executiveId,
          action: 'sequence_execution.submission_requested',
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: { serverTemplateId: version.serverTemplateId, prospectCount: validRows.length, retry: isRetry, correlationId },
        },
        ctx,
      );

      const existingCommand = await this.commands.findByIdempotencyKey(input.organizationId, commandStorageKey, ctx);
      if (existingCommand) return existingCommand.id;
      const created = await this.commands.create(
        {
          organizationId: input.organizationId,
          commandId: `cmd_${randomUUID()}`,
          commandType: 'SEQUENCE_EXECUTION_START_REQUESTED',
          aggregateType: 'EXECUTION',
          aggregateId: execution.id,
          schemaVersion: '1.0',
          idempotencyKey: commandStorageKey,
          correlationId,
          payload: { serverTemplateId: version.serverTemplateId, prospectCount: validRows.length },
          requestedBy: input.executiveId,
        },
        ctx,
      );
      return created.id;
    });

    try {
      // §3-7 — the wire payload: serverTemplateId + normalized prospects, nothing else. The server resolves
      // the Plantilla, its active version, and the associated mailbox entirely on its own from serverTemplateId.
      const result = await this.motor.startExecution({
        idempotencyKey,
        correlationId,
        localExecutionId: execution.id,
        serverTemplateId: version.serverTemplateId,
        prospects: validRows.map((row) => ({
          localProspectId: row.id,
          email: row.normalizedData!.email,
          variables: {
            ...(row.normalizedData!.contactName ? { contact_name: row.normalizedData!.contactName } : {}),
            ...(row.normalizedData!.companyName ? { company_name: row.normalizedData!.companyName } : {}),
            ...row.normalizedData!.variables,
          },
        })),
      });

      if (result.accepted) {
        // §2 — the fixed contractual rule holds even if the server's response omits the field.
        const initialProspectState = result.initialProspectState ?? 'STEP_01_PENDING';
        // ETAPA C — transacción de resultado: entidad + IntegrationCommand +
        // auditoría, todo o nada. El motor ya respondió; esto solo persiste
        // su respuesta.
        await this.tx.run(async (ctx) => {
          await this.executions.update(
            execution.id,
            {
              status: 'ACCEPTED',
              serverExecutionId: result.serverExecutionId,
              executionTokenCiphertext: result.executionToken ? this.secrets.encrypt(result.executionToken) : null,
              receivedAt: result.receivedAt,
              initialProspectState,
              receivedProspects: result.receivedProspects,
              acceptedProspects: result.acceptedProspects,
              rejectedProspects: result.rejectedProspects,
              lastError: null,
              lastSyncedAt: new Date(),
            },
            ctx,
          );
          await this.commands.update(
            commandRowId,
            { status: 'COMPLETED', completedAt: new Date(), resultSnapshot: { serverExecutionId: result.serverExecutionId } },
            ctx,
          );
          await this.audit.record(
            {
              organizationId: input.organizationId,
              actorId: input.executiveId,
              action: 'sequence_execution.accepted',
              entityType: 'SequenceExecution',
              entityId: execution.id,
              metadata: {
                serverExecutionId: result.serverExecutionId,
                receivedProspects: result.receivedProspects,
                acceptedProspects: result.acceptedProspects,
                rejectedProspects: result.rejectedProspects,
                initialProspectState,
                receivedAt: result.receivedAt,
                correlationId,
              },
            },
            ctx,
          );
        });
        await this.prospectImports.markAccepted(execution.id, initialProspectState);
        // Fase "Conversaciones persistentes" — resolve/create Company and
        // Contact for this Gestión's accepted prospects, reusing the same
        // tables the legacy import flow already writes to, so a Conversation
        // created against this execution can carry a real contactId/
        // companyId. Best-effort: a failure here must never undo an already-
        // accepted submission — the resolver itself is idempotent, so a
        // later retry (e.g. a manual re-run, once available) safely catches
        // up on whatever rows are still unresolved.
        try {
          await this.prospectIdentity.resolveForExecution(input.organizationId, execution.id, execution.mailboxId);
        } catch (identityError) {
          console.error(
            JSON.stringify({
              event: 'start_sequence_execution.identity_resolution_failed',
              executionId: execution.id,
              organizationId: input.organizationId,
              message: identityError instanceof Error ? identityError.message : 'unknown error',
            }),
          );
        }
      } else {
        await this.tx.run(async (ctx) => {
          await this.executions.update(
            execution.id,
            { status: 'REJECTED', serverStatus: 'REJECTED', lastError: result.rejectionReason, lastSyncedAt: new Date() },
            ctx,
          );
          await this.commands.update(
            commandRowId,
            { status: 'FAILED', completedAt: new Date(), lastError: result.rejectionReason },
            ctx,
          );
          await this.audit.record(
            {
              organizationId: input.organizationId,
              actorId: input.executiveId,
              action: 'sequence_execution.rejected',
              entityType: 'SequenceExecution',
              entityId: execution.id,
              metadata: { error: result.rejectionReason, correlationId },
            },
            ctx,
          );
        });
      }

      return this.executionsService.getOwned(input.organizationId, input.executiveId, execution.id);
    } catch (error) {
      // §12 — the motor itself could not be reached or timed out: Mr
      // Outreach genuinely does not know whether the server received the
      // command, so it must NOT revert to DRAFT (that would risk a
      // second, duplicate remote Gestión on the next attempt) and must
      // NOT mark it FAILED (that would falsely claim a definitive
      // outcome). SUBMISSION_UNKNOWN is exactly this "verifying" state;
      // the next /start call on this Gestión is treated as a retry and
      // reuses the same idempotencyKey.
      await this.executions.update(execution.id, { status: 'SUBMISSION_UNKNOWN' }).catch(() => undefined);
      await this.audit
        .record({
          organizationId: input.organizationId,
          actorId: input.executiveId,
          action: 'sequence_execution.submission_failed',
          entityType: 'SequenceExecution',
          entityId: execution.id,
          metadata: {
            error: error instanceof Error ? error.message : 'Error desconocido al enviar la gestión.',
            transport: error instanceof ServiceUnavailableException,
            retryable: true,
            correlationId,
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** §5 — "Gestión_DDMMYYYY", from the real moment this command is sent (America/Santiago), with an underscore-suffixed correlativo ("_2", "_3", ...) on a same-day collision. Generated in the backend, never trusted from the browser, never sent to the server. */
  private async generateManagementName(organizationId: string, executiveId: string, requestedAt: Date): Promise<string> {
    const base = generateSequenceName(calendarDateInTimezone(requestedAt, SANTIAGO_TIMEZONE));
    const existing = await this.executions.findByExecutive(organizationId, executiveId);
    const existingNames = new Set(existing.map((e) => e.name).filter((n): n is string => Boolean(n)));
    if (!existingNames.has(base)) return base;
    let suffix = 2;
    while (existingNames.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }
}
