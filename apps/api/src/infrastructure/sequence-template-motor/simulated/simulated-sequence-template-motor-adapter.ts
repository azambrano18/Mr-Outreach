import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SequenceTemplateMotorPort } from '../../../domain/sequence-template-motor/sequence-template-motor-port';
import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplateStatusSnapshot,
  UpdateSequenceTemplateInput,
  UpdateSequenceTemplateResult,
} from '../../../domain/sequence-template-motor/sequence-template-motor.types';

interface PublishedTemplateRecord {
  serverTemplateId: string;
  status: 'ACCEPTED' | 'FAILED';
}

/**
 * §13 — the only adapter used by automated tests and this phase's manual
 * validation. No network call happens anywhere in this class; scenarios
 * are chosen explicitly via `setNextPublishOutcome`/`setMotorUnavailable`,
 * mirroring `SimulatedMailboxMotorAdapter`'s simulation philosophy.
 */
@Injectable()
export class SimulatedSequenceTemplateMotorAdapter implements SequenceTemplateMotorPort {
  private readonly publishedByIdempotencyKey = new Map<string, PublishSequenceTemplateResult>();
  private readonly updatedByIdempotencyKey = new Map<string, UpdateSequenceTemplateResult>();
  private readonly registry = new Map<string, PublishedTemplateRecord>();
  private motorUnavailable = false;
  private nextOutcome: 'ACCEPTED' | 'FAILED' = 'ACCEPTED';
  private nextUpdateOutcome: 'APPLIED' | 'FAILED' = 'APPLIED';

  setMotorUnavailable(unavailable: boolean): void {
    this.motorUnavailable = unavailable;
  }

  /** Fixture control — the next `publishTemplate` call (only) will simulate this outcome. Resets to ACCEPTED after use. */
  setNextPublishOutcome(outcome: 'ACCEPTED' | 'FAILED'): void {
    this.nextOutcome = outcome;
  }

  /** Fixture control — the next `updateTemplate` call (only) will simulate this outcome. Resets to APPLIED after use. */
  setNextUpdateOutcome(outcome: 'APPLIED' | 'FAILED'): void {
    this.nextUpdateOutcome = outcome;
  }

  async publishTemplate(input: PublishSequenceTemplateInput): Promise<PublishSequenceTemplateResult> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }

    const existing = this.publishedByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;

    const outcome = this.nextOutcome;
    this.nextOutcome = 'ACCEPTED';

    const result: PublishSequenceTemplateResult =
      outcome === 'ACCEPTED'
        ? {
            accepted: true,
            serverTemplateId: `tpl_${randomUUID()}`,
            templateToken: `tpt_${randomUUID()}`,
            version: input.version,
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            rejectionReason: null,
          }
        : {
            accepted: false,
            serverTemplateId: null,
            templateToken: null,
            version: input.version,
            status: 'FAILED',
            acceptedAt: null,
            rejectionReason: 'Simulación: el motor rechazó la publicación.',
          };

    this.publishedByIdempotencyKey.set(input.idempotencyKey, result);
    if (result.accepted && result.serverTemplateId) {
      this.registry.set(result.serverTemplateId, { serverTemplateId: result.serverTemplateId, status: 'ACCEPTED' });
    }
    return result;
  }

  /**
   * §12-17 — simulated: this adapter has no real Railway job queue to
   * inspect, so `affectedPendingJobs`/`unchangedSentJobs`/
   * `processingJobsNotChanged` are always 0 here (a real Railway would
   * compute them from its own scheduler state, not from anything Mr
   * Outreach sends). `affectedExecutions` mirrors the caller's own
   * count so the confirmation modal's estimate and the persisted result
   * agree in this simulation.
   */
  async updateTemplate(input: UpdateSequenceTemplateInput): Promise<UpdateSequenceTemplateResult> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }

    const existing = this.updatedByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;

    const outcome = this.nextUpdateOutcome;
    this.nextUpdateOutcome = 'APPLIED';

    const result: UpdateSequenceTemplateResult =
      outcome === 'APPLIED'
        ? {
            accepted: true,
            serverTemplateId: input.serverTemplateId,
            previousVersion: input.currentVersion,
            newVersion: input.newVersion,
            templateToken: `tpt_${randomUUID()}`,
            status: 'APPLIED',
            effectiveScope: 'FUTURE_UNSENT_JOBS',
            affectedExecutions: null,
            affectedPendingJobs: 0,
            unchangedSentJobs: 0,
            processingJobsNotChanged: 0,
            appliedAt: new Date(),
            rejectionReason: null,
          }
        : {
            accepted: false,
            serverTemplateId: null,
            previousVersion: input.currentVersion,
            newVersion: input.newVersion,
            templateToken: null,
            status: 'FAILED',
            effectiveScope: 'FUTURE_UNSENT_JOBS',
            affectedExecutions: null,
            affectedPendingJobs: null,
            unchangedSentJobs: null,
            processingJobsNotChanged: null,
            appliedAt: null,
            rejectionReason: 'Simulación: el motor rechazó la actualización.',
          };

    this.updatedByIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  async getTemplateStatus(serverTemplateId: string): Promise<SequenceTemplateStatusSnapshot> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }
    const record = this.registry.get(serverTemplateId);
    return {
      serverTemplateId,
      status: record?.status ?? 'ACCEPTED',
      checkedAt: new Date(),
    };
  }
}
