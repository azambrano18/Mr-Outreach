import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { SequenceTemplateMotorPort } from '../../../domain/sequence-template-motor/sequence-template-motor-port';
import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplateMotorStepInput,
  SequenceTemplatePublishStatus,
  SequenceTemplateStatusSnapshot,
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

interface WireStatusResponse {
  serverTemplateId: string;
  status: SequenceTemplatePublishStatus;
  checkedAt: string;
}

/** Envío 1 never carries a wait — it runs from the Gestión's own start until the fixed 19:00 cutoff, so the wire schedule marks it with a `type` instead of a `delayValue`/`delayUnit` pair (docs/railway-integration-contract-v1.md §Contrato de publicación). */
function buildWireSchedule(step: SequenceTemplateMotorStepInput): Record<string, unknown> {
  if (step.stepNumber === 1) {
    return {
      type: 'EXECUTION_START_UNTIL_19',
      allowedWeekdays: step.schedule.allowedWeekdays,
      sendWindowEnd: step.schedule.sendWindowEnd,
    };
  }
  return {
    delayValue: step.schedule.delayValue,
    delayUnit: step.schedule.delayUnit,
    allowedWeekdays: step.schedule.allowedWeekdays,
    sendWindowStart: step.schedule.sendWindowStart,
    sendWindowEnd: step.schedule.sendWindowEnd,
  };
}

/**
 * §10-13 — prepared-but-unimplemented driver (no real Railway "Sequence
 * Template Motor" is reachable yet, same status as HttpMailboxMotorAdapter).
 * Only ever constructed when SEQUENCE_MOTOR_MODE=http. No HTTP detail leaks
 * past this class — every method returns/throws exactly what
 * SequenceTemplateMotorPort's own doc comment promises.
 *
 * Consolidación contractual — ONE command (`TEMPLATE_VERSION_PUBLISH`) for
 * both a first publish and every later version; see
 * docs/railway-integration-contract-v1.md for the full wire contract.
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
          commandType: 'TEMPLATE_VERSION_PUBLISH',
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          organizationId: input.organizationId,
          executiveUserId: input.executiveUserId,
          template: {
            localTemplateId: input.localTemplateId,
            previousServerTemplateId: input.previousServerTemplateId,
            name: input.name,
            version: input.version,
            serverMailboxId: input.serverMailboxId,
            mailboxEmail: input.mailboxEmail,
            timezone: input.timezone,
            subjectTemplate: input.subjectTemplate,
            signatureHtml: input.signatureHtml,
            variables: input.variables,
            sends: input.steps.map((step) => ({
              sendNumber: step.stepNumber,
              headerText: step.headerText,
              bodyHtml: step.bodyHtml,
              bodyText: step.bodyText,
              schedule: buildWireSchedule(step),
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
