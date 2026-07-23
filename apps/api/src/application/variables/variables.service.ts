import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { Variable, VariableStatus } from '../../domain/variable/variable.entity';
import { VariableRepository } from '../../domain/variable/variable.repository';
import {
  AUDIT_LOG_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  VARIABLE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { CreateVariablePayload, UpdateVariablePayload, VariableSummary } from './variables.types';

@Injectable()
export class VariablesService {
  constructor(
    @Inject(VARIABLE_REPOSITORY) private readonly variables: VariableRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly sequenceSteps: SequenceStepRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
  ) {}

  async list(organizationId: string): Promise<VariableSummary[]> {
    const rows = await this.variables.findAll(organizationId);
    return rows.map((row) => this.toSummary(row));
  }

  async getById(organizationId: string, variableId: string): Promise<VariableSummary> {
    const variable = await this.getOwnedVariable(organizationId, variableId);
    return this.toSummary(variable);
  }

  async create(
    organizationId: string,
    input: CreateVariablePayload,
    actorId: string,
  ): Promise<VariableSummary> {
    const variable = await this.variables.create({
      organizationId,
      key: input.key,
      label: input.label,
      description: null,
      source: 'CUSTOM',
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'variable.create',
      entityType: 'Variable',
      entityId: variable.id,
      metadata: { key: variable.key },
    });

    return this.toSummary(variable);
  }

  async update(
    organizationId: string,
    variableId: string,
    input: UpdateVariablePayload,
    actorId: string,
  ): Promise<VariableSummary> {
    const existing = await this.getOwnedVariable(organizationId, variableId);

    // Never spread `undefined` fields into the repository call — see
    // TemplatesService.update for why.
    const patch: UpdateVariablePayload = {};
    if (input.key !== undefined) patch.key = input.key;
    if (input.label !== undefined) patch.label = input.label;

    const updated = await this.variables.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'variable.update',
      entityType: 'Variable',
      entityId: variableId,
    });

    return this.toSummary(updated);
  }

  async setStatus(
    organizationId: string,
    variableId: string,
    status: VariableStatus,
    actorId: string,
  ): Promise<VariableSummary> {
    const existing = await this.getOwnedVariable(organizationId, variableId);
    const updated = await this.variables.update(existing.id, { status });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: status === 'ARCHIVED' ? 'variable.archive' : 'variable.restore',
      entityType: 'Variable',
      entityId: variableId,
    });

    return this.toSummary(updated);
  }

  /**
   * Only ever removes a variable that has never been referenced — per spec
   * §5.4, one that's already been used in a sequence step or a signature
   * must be archived instead, so historical content keeps a resolvable
   * catalog entry. Checks every (non-deleted) sequence step's text fields
   * and every mailbox's *active* signature version in the org — archived
   * signature versions are dead text no longer reachable from any live
   * screen, so they don't gate deletion.
   */
  async remove(organizationId: string, variableId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedVariable(organizationId, variableId);

    if (await this.isKeyInUse(organizationId, existing.key)) {
      throw new BadRequestException(
        'Esta variable ya fue utilizada en una secuencia o firma. Desactívala en vez de eliminarla.',
      );
    }

    await this.variables.remove(existing.id);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'variable.delete',
      entityType: 'Variable',
      entityId: variableId,
      metadata: { key: existing.key },
    });
  }

  private async isKeyInUse(organizationId: string, key: string): Promise<boolean> {
    const token = `{${key}}`;

    const steps = await this.sequenceSteps.findAllByOrganization(organizationId);
    const usedInSteps = steps.some(
      (step) =>
        step.subject.includes(token) ||
        (step.preheader ?? '').includes(token) ||
        (step.htmlHeader ?? '').includes(token) ||
        step.htmlBody.includes(token) ||
        step.plainTextBody.includes(token),
    );
    if (usedInSteps) return true;

    const orgSignatures = await this.signatures.findAllByOrganization(organizationId);
    for (const signature of orgSignatures) {
      if (!signature.activeVersionId) continue;
      const version = await this.signatureVersions.findById(signature.activeVersionId);
      if (!version) continue;
      if (version.htmlContent.includes(token) || version.plainTextContent.includes(token)) {
        return true;
      }
    }

    return false;
  }

  /** Same 404-not-403 rule as UsersService — see its comment for why. */
  private async getOwnedVariable(organizationId: string, variableId: string): Promise<Variable> {
    const variable = await this.variables.findById(variableId);
    if (!variable || variable.organizationId !== organizationId) {
      throw new NotFoundException('Variable not found.');
    }
    return variable;
  }

  private toSummary(variable: Variable): VariableSummary {
    return {
      id: variable.id,
      organizationId: variable.organizationId,
      key: variable.key,
      label: variable.label,
      description: variable.description,
      source: variable.source,
      status: variable.status,
      createdAt: variable.createdAt,
      updatedAt: variable.updatedAt,
    };
  }
}
