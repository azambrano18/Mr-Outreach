import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { SequenceTemplateMotorPort } from '../../../domain/sequence-template-motor/sequence-template-motor-port';
import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplatePublishStatus,
  SequenceTemplateStatusSnapshot,
  SequenceTemplateUpdateStatus,
  UpdateSequenceTemplateInput,
  UpdateSequenceTemplateResult,
} from '../../../domain/sequence-template-motor/sequence-template-motor.types';

interface WirePublishResponse {
  accepted: boolean;
  serverTemplateId: string | null;
  templateToken: string | null;
  version: number;
  status: SequenceTemplatePublishStatus;
  acceptedAt: string | null;
  rejectionReason?: string | null;
}

interface WireUpdateResponse {
  accepted: boolean;
  serverTemplateId: string | null;
  previousVersion: number;
  newVersion: number;
  templateToken: string | null;
  status: SequenceTemplateUpdateStatus;
  effectiveScope: 'FUTURE_UNSENT_JOBS';
  affectedExecutions: number | null;
  affectedPendingJobs: number | null;
  unchangedSentJobs: number | null;
  processingJobsNotChanged: number | null;
  appliedAt: string | null;
  rejectionReason?: string | null;
}

interface WireStatusResponse {
  serverTemplateId: string;
  status: SequenceTemplatePublishStatus;
  checkedAt: string;
}

/**
 * §10-13 — prepared-but-unimplemented driver (no real Railway "Sequence
 * Template Motor" is reachable yet, same status as HttpMailboxMotorAdapter).
 * Only ever constructed when SEQUENCE_MOTOR_MODE=http. No HTTP detail leaks
 * past this class — every method returns/throws exactly what
 * SequenceTemplateMotorPort's own doc comment promises.
 */
@Injectable()
export class HttpSequenceTemplateMotorAdapter implements SequenceTemplateMotorPort {
  private readonly logger = new Logger(HttpSequenceTemplateMotorAdapter.name);

  constructor(private readonly config: AppConfigService) {}

  async publishTemplate(input: PublishSequenceTemplateInput): Promise<PublishSequenceTemplateResult> {
    const response = await this.request(
      '/v1/sequence-templates/publish',
      {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: '1.0',
          commandType: 'SEQUENCE_TEMPLATE_PUBLISH',
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          organization: { organizationId: input.organizationId },
          executive: { userId: input.executiveUserId },
          mailbox: { localMailboxId: input.localTemplateId, serverMailboxId: input.serverMailboxId, email: input.mailboxEmail },
          template: {
            localTemplateId: input.localTemplateId,
            name: input.name,
            version: input.version,
            timezone: input.timezone,
            subjectTemplate: input.subjectTemplate,
            signatureHtml: input.signatureHtml,
            variables: input.variables,
            steps: input.steps.map((step) => ({
              stepNumber: step.stepNumber,
              headerText: step.headerText,
              bodyHtml: step.bodyHtml,
              bodyText: step.bodyText,
              schedule: step.schedule,
            })),
          },
        }),
      },
      { idempotencyKey: input.idempotencyKey, correlationId: input.correlationId },
    );
    const body = await this.parseJson<WirePublishResponse>(response);
    return {
      accepted: body.accepted,
      serverTemplateId: body.serverTemplateId,
      templateToken: body.templateToken,
      version: body.version,
      status: body.status,
      acceptedAt: body.acceptedAt ? new Date(body.acceptedAt) : null,
      rejectionReason: body.rejectionReason ?? null,
    };
  }

  /** §12-17 — a distinct command (`SEQUENCE_TEMPLATE_UPDATE`) from `publishTemplate`'s `SEQUENCE_TEMPLATE_PUBLISH`; never reuse the initial-publish command when the server needs to tell create and update apart. */
  async updateTemplate(input: UpdateSequenceTemplateInput): Promise<UpdateSequenceTemplateResult> {
    const response = await this.request(
      '/v1/sequence-templates/update',
      {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: '1.0',
          commandType: 'SEQUENCE_TEMPLATE_UPDATE',
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          organization: { organizationId: input.organizationId },
          executive: { userId: input.executiveUserId },
          mailbox: { serverMailboxId: input.serverMailboxId, email: input.mailboxEmail },
          template: {
            localTemplateId: input.localTemplateId,
            serverTemplateId: input.serverTemplateId,
            name: input.name,
            currentVersion: input.currentVersion,
            newVersion: input.newVersion,
            timezone: input.timezone,
            subjectTemplate: input.subjectTemplate,
            signatureHtml: input.signatureHtml,
            variables: input.variables,
            effectiveScope: input.effectiveScope,
            steps: input.steps.map((step) => ({
              stepNumber: step.stepNumber,
              headerText: step.headerText,
              bodyHtml: step.bodyHtml,
              bodyText: step.bodyText,
              schedule: step.schedule,
            })),
          },
        }),
      },
      { idempotencyKey: input.idempotencyKey, correlationId: input.correlationId },
    );
    const body = await this.parseJson<WireUpdateResponse>(response);
    return {
      accepted: body.accepted,
      serverTemplateId: body.serverTemplateId,
      previousVersion: body.previousVersion,
      newVersion: body.newVersion,
      templateToken: body.templateToken,
      status: body.status,
      effectiveScope: body.effectiveScope,
      affectedExecutions: body.affectedExecutions,
      affectedPendingJobs: body.affectedPendingJobs,
      unchangedSentJobs: body.unchangedSentJobs,
      processingJobsNotChanged: body.processingJobsNotChanged,
      appliedAt: body.appliedAt ? new Date(body.appliedAt) : null,
      rejectionReason: body.rejectionReason ?? null,
    };
  }

  async getTemplateStatus(serverTemplateId: string): Promise<SequenceTemplateStatusSnapshot> {
    const response = await this.request(`/v1/sequence-templates/${encodeURIComponent(serverTemplateId)}/status`, {
      method: 'GET',
    });
    const body = await this.parseJson<WireStatusResponse>(response);
    return { serverTemplateId: body.serverTemplateId, status: body.status, checkedAt: new Date(body.checkedAt) };
  }

  private async request(
    path: string,
    init: RequestInit,
    idempotency?: { idempotencyKey?: string; correlationId?: string },
  ): Promise<Response> {
    const baseUrl = this.config.sequenceMotorBaseUrl;
    if (!baseUrl) {
      throw new ServiceUnavailableException('SEQUENCE_MOTOR_BASE_URL no está configurada.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.sequenceMotorTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.sequenceMotorApiKey}`,
          'X-Correlation-Id': idempotency?.correlationId ?? randomUUID(),
          ...(idempotency?.idempotencyKey ? { 'Idempotency-Key': idempotency.idempotencyKey } : {}),
        },
      });
    } catch {
      this.logger.warn(`Sequence template motor request to ${path} failed or timed out.`);
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }
    return response;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('Respuesta inválida del servidor motor.');
    }
  }
}
