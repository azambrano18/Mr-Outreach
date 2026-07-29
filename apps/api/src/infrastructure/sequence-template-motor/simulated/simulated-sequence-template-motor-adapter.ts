import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SequenceTemplateMotorPort } from '../../../domain/sequence-template-motor/sequence-template-motor-port';
import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplateStatusSnapshot,
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
 *
 * Consolidación contractual — every accepted call generates a fresh,
 * unique `serverTemplateId` via `randomUUID()`, whether it's a template's
 * first publish or a later version (`input.previousServerTemplateId` set).
 * There is no "update in place" path that could ever reuse a prior id.
 */
@Injectable()
export class SimulatedSequenceTemplateMotorAdapter implements SequenceTemplateMotorPort {
  private readonly publishedByIdempotencyKey = new Map<string, PublishSequenceTemplateResult>();
  private readonly registry = new Map<string, PublishedTemplateRecord>();
  private motorUnavailable = false;
  private nextOutcome: 'ACCEPTED' | 'FAILED' = 'ACCEPTED';

  setMotorUnavailable(unavailable: boolean): void {
    this.motorUnavailable = unavailable;
  }

  /** Fixture control — the next `publishTemplate` call (only) will simulate this outcome. Resets to ACCEPTED after use. */
  setNextPublishOutcome(outcome: 'ACCEPTED' | 'FAILED'): void {
    this.nextOutcome = outcome;
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
            // Unique per call — never derived from input.previousServerTemplateId.
            serverTemplateId: `tplv_${randomUUID()}`,
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
