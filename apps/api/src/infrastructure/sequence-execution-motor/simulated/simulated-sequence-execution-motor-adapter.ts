import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProspectExecutionState } from '../../../domain/prospect-import/prospect-import-row.entity';
import { SequenceExecutionMotorPort } from '../../../domain/sequence-execution-motor/sequence-execution-motor-port';
import {
  SequenceExecutionServerStatus,
  SequenceExecutionStatusSnapshot,
  StartSequenceExecutionInput,
  StartSequenceExecutionResult,
} from '../../../domain/sequence-execution-motor/sequence-execution-motor.types';

interface ExecutionRecord {
  serverExecutionId: string;
  status: SequenceExecutionServerStatus;
  receivedProspects: number;
  estimatedStartAt: Date | null;
  startedAt: Date | null;
}

/**
 * §13/§20 — the only adapter used by automated tests and this phase's
 * manual validation. No network call happens anywhere in this class.
 * Represents exactly the simplified contract: it only ever receives
 * `serverTemplateId` + normalized prospects, resolves the Plantilla
 * internally (a lookup against its own fixture registry — never
 * something Mr Outreach tells it how to do), and assigns every accepted
 * prospect `STEP_01_PENDING` on its own initiative.
 */
@Injectable()
export class SimulatedSequenceExecutionMotorAdapter implements SequenceExecutionMotorPort {
  private readonly submittedByIdempotencyKey = new Map<string, StartSequenceExecutionResult>();
  private readonly registry = new Map<string, ExecutionRecord>();
  private motorUnavailable = false;
  private nextOutcome: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED';
  private nextRejectionReason = 'Simulación: el motor rechazó el inicio de la gestión.';
  /** Fixture control only — this is the server's OWN choice, never something Mr Outreach requests. */
  private nextInitialProspectState: ProspectExecutionState | null = 'STEP_01_PENDING';

  setMotorUnavailable(unavailable: boolean): void {
    this.motorUnavailable = unavailable;
  }

  /** Fixture control — the next `startExecution` call (only) will simulate this outcome. Resets to ACCEPTED after use. */
  setNextStartOutcome(outcome: 'ACCEPTED' | 'REJECTED', rejectionReason?: string): void {
    this.nextOutcome = outcome;
    if (rejectionReason) this.nextRejectionReason = rejectionReason;
  }

  /** Fixture control — lets a test simulate a server that omits `initialProspectState` from its response; Mr Outreach must still default to STEP_01_PENDING locally. */
  setNextInitialProspectState(state: ProspectExecutionState | null): void {
    this.nextInitialProspectState = state;
  }

  /** Fixture control — what a later getExecutionStatus() reports for a given serverExecutionId. */
  setStatusSnapshot(
    serverExecutionId: string,
    snapshot: Partial<Omit<SequenceExecutionStatusSnapshot, 'serverExecutionId' | 'checkedAt'>>,
  ): void {
    this.statusOverrides.set(serverExecutionId, snapshot);
  }

  private readonly statusOverrides = new Map<
    string,
    Partial<Omit<SequenceExecutionStatusSnapshot, 'serverExecutionId' | 'checkedAt'>>
  >();

  async startExecution(input: StartSequenceExecutionInput): Promise<StartSequenceExecutionResult> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }

    // §12 — idempotent by idempotencyKey: a retry (double-click or timeout recovery) never creates a second remote Gestión.
    const existing = this.submittedByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;

    const outcome = this.nextOutcome;
    const rejectionReason = this.nextRejectionReason;
    const initialProspectState = this.nextInitialProspectState;
    this.nextOutcome = 'ACCEPTED';
    this.nextRejectionReason = 'Simulación: el motor rechazó el inicio de la gestión.';
    this.nextInitialProspectState = 'STEP_01_PENDING';

    const receivedProspects = input.prospects.length;

    const result: StartSequenceExecutionResult =
      outcome === 'ACCEPTED'
        ? {
            accepted: true,
            serverExecutionId: `exec_${randomUUID()}`,
            executionToken: `ext_${randomUUID()}`,
            status: 'ACCEPTED',
            receivedProspects,
            acceptedProspects: receivedProspects,
            rejectedProspects: 0,
            initialProspectState,
            receivedAt: new Date(),
            rejectionReason: null,
          }
        : {
            accepted: false,
            serverExecutionId: null,
            executionToken: null,
            status: 'REJECTED',
            receivedProspects: 0,
            acceptedProspects: 0,
            rejectedProspects: 0,
            initialProspectState: null,
            receivedAt: null,
            rejectionReason,
          };

    this.submittedByIdempotencyKey.set(input.idempotencyKey, result);
    if (result.accepted && result.serverExecutionId) {
      this.registry.set(result.serverExecutionId, {
        serverExecutionId: result.serverExecutionId,
        status: 'QUEUED',
        receivedProspects: result.receivedProspects,
        estimatedStartAt: null,
        startedAt: null,
      });
    }
    return result;
  }

  /** Fixture control — moves a previously-accepted execution to RUNNING, as the server itself would once it dequeues it internally. */
  advanceToRunning(serverExecutionId: string, startedAt: Date = new Date()): void {
    const record = this.registry.get(serverExecutionId);
    if (record) {
      record.status = 'RUNNING';
      record.startedAt = startedAt;
    }
  }

  async getExecutionStatus(serverExecutionId: string): Promise<SequenceExecutionStatusSnapshot> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }
    const record = this.registry.get(serverExecutionId);
    const override = this.statusOverrides.get(serverExecutionId);
    return {
      serverExecutionId,
      status: override?.status ?? record?.status ?? 'QUEUED',
      currentStepNumber: override?.currentStepNumber ?? (record?.status === 'RUNNING' ? 1 : null),
      sentCount: override?.sentCount ?? 0,
      pendingCount: override?.pendingCount ?? record?.receivedProspects ?? 0,
      failedCount: override?.failedCount ?? 0,
      estimatedStartAt: override?.estimatedStartAt ?? record?.estimatedStartAt ?? null,
      startedAt: override?.startedAt ?? record?.startedAt ?? null,
      lastError: override?.lastError ?? null,
      checkedAt: new Date(),
    };
  }
}
