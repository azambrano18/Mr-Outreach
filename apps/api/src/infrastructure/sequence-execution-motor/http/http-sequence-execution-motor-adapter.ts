import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { ProspectExecutionState } from '../../../domain/prospect-import/prospect-import-row.entity';
import { SequenceExecutionMotorPort } from '../../../domain/sequence-execution-motor/sequence-execution-motor-port';
import {
  SequenceExecutionServerStatus,
  SequenceExecutionStatusSnapshot,
  SequenceExecutionSubmitStatus,
  StartSequenceExecutionInput,
  StartSequenceExecutionResult,
} from '../../../domain/sequence-execution-motor/sequence-execution-motor.types';

interface WireStartResponse {
  accepted: boolean;
  serverExecutionId: string | null;
  executionToken?: string | null;
  status: SequenceExecutionSubmitStatus;
  receivedProspects: number;
  acceptedProspects: number;
  rejectedProspects: number;
  /** Optional — the server may omit it because the rule (STEP_01_PENDING) is fixed by contract. */
  initialProspectState?: ProspectExecutionState | null;
  receivedAt: string | null;
  rejectionReason?: string | null;
}

interface WireStatusResponse {
  serverExecutionId: string;
  status: SequenceExecutionServerStatus;
  currentStepNumber: number | null;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
  estimatedStartAt?: string | null;
  startedAt?: string | null;
  lastError: string | null;
  checkedAt: string;
}

/**
 * §13/§18-20 — prepared-but-unimplemented driver (no real server "Sequence
 * Execution Motor" is reachable yet).
 *
 * §3-7 (schema v3.0) — "Mr Outreach solo envía la base asociada al ID de
 * la Plantilla." The wire payload carries nothing beyond `serverTemplateId`
 * and the normalized prospect list — no queue/dispatch/priority/worker
 * instruction, no technical owner, no initial step, no scheduled date.
 */
@Injectable()
export class HttpSequenceExecutionMotorAdapter implements SequenceExecutionMotorPort {
  private readonly logger = new Logger(HttpSequenceExecutionMotorAdapter.name);

  constructor(private readonly config: AppConfigService) {}

  async startExecution(input: StartSequenceExecutionInput): Promise<StartSequenceExecutionResult> {
    const response = await this.request(
      '/v1/sequence-executions/start',
      {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: '3.0',
          commandType: 'SEQUENCE_EXECUTION_START',
          commandId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          template: {
            serverTemplateId: input.serverTemplateId,
          },
          execution: {
            localExecutionId: input.localExecutionId,
          },
          prospects: input.prospects.map((p) => ({
            localProspectId: p.localProspectId,
            email: p.email,
            variables: p.variables,
          })),
        }),
      },
      { idempotencyKey: input.idempotencyKey, correlationId: input.correlationId },
    );
    const body = await this.parseJson<WireStartResponse>(response);
    return {
      accepted: body.accepted,
      serverExecutionId: body.serverExecutionId,
      executionToken: body.executionToken ?? null,
      status: body.status,
      receivedProspects: body.receivedProspects,
      acceptedProspects: body.acceptedProspects,
      rejectedProspects: body.rejectedProspects,
      initialProspectState: body.initialProspectState ?? null,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : null,
      rejectionReason: body.rejectionReason ?? null,
    };
  }

  async getExecutionStatus(serverExecutionId: string): Promise<SequenceExecutionStatusSnapshot> {
    const response = await this.request(`/v1/sequence-executions/${encodeURIComponent(serverExecutionId)}/status`, {
      method: 'GET',
    });
    const body = await this.parseJson<WireStatusResponse>(response);
    return {
      serverExecutionId: body.serverExecutionId,
      status: body.status,
      currentStepNumber: body.currentStepNumber,
      sentCount: body.sentCount,
      pendingCount: body.pendingCount,
      failedCount: body.failedCount,
      estimatedStartAt: body.estimatedStartAt ? new Date(body.estimatedStartAt) : null,
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      lastError: body.lastError,
      checkedAt: new Date(body.checkedAt),
    };
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
      this.logger.warn(`Sequence execution motor request to ${path} failed or timed out.`);
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
