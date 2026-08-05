import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProspectExecutionState } from '../../../domain/prospect-import/prospect-import-row.entity';
import { SequenceExecutionMotorPort } from '../../../domain/sequence-execution-motor/sequence-execution-motor-port';
import {
  ExecutionControlCommandInput,
  ExecutionControlCommandResult,
  SequenceExecutionServerStatus,
  SequenceExecutionStatusSnapshot,
  StartSequenceExecutionInput,
  StartSequenceExecutionResult,
} from '../../../domain/sequence-execution-motor/sequence-execution-motor.types';

/**
 * Fase "Control operativo de Gestiones" — ACTIVE dispatches new emails
 * normally; PAUSED/STOPPED both suspend it, distinguished only so a
 * resume from PAUSED is meaningful while STOPPED is terminal (mirrors the
 * local SequenceExecutionStatus machine one level down, inside the motor
 * itself).
 */
type ExecutionControlState = 'ACTIVE' | 'PAUSED' | 'STOPPED';

interface ExecutionRecord {
  serverExecutionId: string;
  status: SequenceExecutionServerStatus;
  receivedProspects: number;
  estimatedStartAt: Date | null;
  startedAt: Date | null;
  controlState: ExecutionControlState;
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
        controlState: 'ACTIVE',
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

  // -------------------------------------------------------------------
  // Fase "Control operativo de Gestiones"
  // -------------------------------------------------------------------

  /** Fixture control — the next pause/resume/stop call (only) simulates this outcome. Resets to ACCEPTED after use. */
  setNextControlOutcome(outcome: 'ACCEPTED' | 'REJECTED', rejectionReason?: string): void {
    this.nextControlOutcome = outcome;
    if (rejectionReason) this.nextControlRejectionReason = rejectionReason;
  }

  private nextControlOutcome: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED';
  private nextControlRejectionReason = 'Simulación: el motor rechazó el comando de control.';
  private readonly controlByIdempotencyKey = new Map<string, ExecutionControlCommandResult>();

  private async runControlCommand(
    input: ExecutionControlCommandInput,
    apply: (record: ExecutionRecord) => void,
  ): Promise<ExecutionControlCommandResult> {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }

    // Idempotent by idempotencyKey, same convention as startExecution — a
    // retried pause/resume/stop (double click, timeout recovery) never
    // re-applies a second time or returns a different outcome.
    const existing = this.controlByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;

    const outcome = this.nextControlOutcome;
    const rejectionReason = this.nextControlRejectionReason;
    this.nextControlOutcome = 'ACCEPTED';
    this.nextControlRejectionReason = 'Simulación: el motor rechazó el comando de control.';

    const record = this.registry.get(input.serverExecutionId);
    let result: ExecutionControlCommandResult;
    if (outcome === 'REJECTED' || !record) {
      result = {
        accepted: false,
        status: 'REJECTED',
        rejectionReason: !record ? 'Cuenta de ejecución desconocida para el motor.' : rejectionReason,
        acknowledgedAt: null,
      };
    } else {
      apply(record);
      result = { accepted: true, status: 'ACCEPTED', rejectionReason: null, acknowledgedAt: new Date() };
    }

    this.controlByIdempotencyKey.set(input.idempotencyKey, result);
    return result;
  }

  async pauseExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult> {
    return this.runControlCommand(input, (record) => {
      if (record.controlState === 'ACTIVE') record.controlState = 'PAUSED';
    });
  }

  async resumeExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult> {
    return this.runControlCommand(input, (record) => {
      if (record.controlState === 'PAUSED') record.controlState = 'ACTIVE';
    });
  }

  async stopExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult> {
    return this.runControlCommand(input, (record) => {
      record.controlState = 'STOPPED';
    });
  }

  /**
   * The real, observable effect of pause/stop on this simulator: never
   * `true` once `controlState` leaves `ACTIVE`. Tests use this to prove
   * pause/stop actually suspend dispatch, not merely a local status label
   * — see §2 ("después de que el motor confirme PAUSED, no debe comenzar
   * ningún nuevo envío"). A send already handed to the motor before that
   * point is a separate, already-completed fact this method is never
   * consulted for — see `deliverInFlightSend`.
   */
  canDispatchNewEmail(serverExecutionId: string): boolean {
    return this.registry.get(serverExecutionId)?.controlState === 'ACTIVE';
  }

  /**
   * Represents an email the motor had already committed to sending before
   * it processed a pause/stop command — always completes regardless of
   * `controlState`, mirroring §2's "un trabajo ya entregado al motor
   * antes de la aceptación de la pausa puede completar". Returns the
   * count of emails "sent" so far for this execution (fixture bookkeeping
   * only — never used to authorize anything).
   */
  deliverInFlightSend(serverExecutionId: string): number {
    const record = this.registry.get(serverExecutionId);
    if (!record) throw new Error(`Unknown simulated execution ${serverExecutionId}`);
    this.deliveredCounts.set(serverExecutionId, (this.deliveredCounts.get(serverExecutionId) ?? 0) + 1);
    return this.deliveredCounts.get(serverExecutionId)!;
  }

  private readonly deliveredCounts = new Map<string, number>();

  /** Fixture introspection — total emails "delivered" via `deliverInFlightSend` for this execution so far. */
  getDeliveredCount(serverExecutionId: string): number {
    return this.deliveredCounts.get(serverExecutionId) ?? 0;
  }
}
