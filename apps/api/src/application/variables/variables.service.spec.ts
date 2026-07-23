import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersion } from '../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { Signature } from '../../domain/signature/signature.entity';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { Variable } from '../../domain/variable/variable.entity';
import { VariableRepository } from '../../domain/variable/variable.repository';
import { VariablesService } from './variables.service';

describe('VariablesService', () => {
  let variables: jest.Mocked<VariableRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let sequenceSteps: jest.Mocked<SequenceStepRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let service: VariablesService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildVariable = (overrides: Partial<Variable> = {}): Variable => ({
    id: 'variable_1',
    organizationId: orgId,
    key: 'nombre',
    label: 'Nombre del contacto',
    description: null,
    source: 'CONTACT',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const buildStep = (overrides: Partial<SequenceStep> = {}): SequenceStep =>
    ({
      id: 'step_1',
      organizationId: orgId,
      sequenceId: 'sequence_1',
      subject: 'Asunto sin variables',
      preheader: null,
      htmlHeader: null,
      htmlBody: '<p>Cuerpo sin variables</p>',
      plainTextBody: 'Cuerpo sin variables',
      ...overrides,
    }) as SequenceStep;

  const buildSignature = (overrides: Partial<Signature> = {}): Signature =>
    ({
      id: 'signature_1',
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      status: 'ACTIVE',
      activeVersionId: 'version_1',
      ...overrides,
    }) as Signature;

  const buildSignatureVersion = (overrides: Partial<SignatureVersion> = {}): SignatureVersion =>
    ({
      id: 'version_1',
      signatureId: 'signature_1',
      versionNumber: 1,
      htmlContent: '<p>Firma sin variables</p>',
      plainTextContent: 'Firma sin variables',
      ...overrides,
    }) as SignatureVersion;

  beforeEach(() => {
    variables = {
      findById: jest.fn(),
      findByKey: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    sequenceSteps = {
      findById: jest.fn(),
      findBySequence: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    signatures = {
      findById: jest.fn(),
      findByMailbox: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    signatureVersions = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySignature: jest.fn(),
    };

    service = new VariablesService(variables, auditLogs, sequenceSteps, signatures, signatureVersions);
  });

  describe('create', () => {
    it('always persists as a CUSTOM variable with no description, ignoring any other field', async () => {
      variables.create.mockResolvedValue(buildVariable({ source: 'CUSTOM', description: null }));

      const result = await service.create(
        orgId,
        { key: 'nombre', label: 'Nombre del contacto' },
        'actor_1',
      );

      expect(variables.create).toHaveBeenCalledWith({
        organizationId: orgId,
        key: 'nombre',
        label: 'Nombre del contacto',
        description: null,
        source: 'CUSTOM',
      });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'variable.create' }),
      );
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      variables.findById.mockResolvedValue(buildVariable());
      variables.update.mockResolvedValue(buildVariable({ label: 'Renombrada' }));

      await service.update(orgId, 'variable_1', { label: 'Renombrada' }, 'actor_1');

      expect(variables.update).toHaveBeenCalledWith('variable_1', { label: 'Renombrada' });
    });

    it('throws NotFoundException for a variable in a different organization (never 403)', async () => {
      variables.findById.mockResolvedValue(buildVariable({ organizationId: otherOrgId }));

      await expect(service.update(orgId, 'variable_1', { label: 'X' }, 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(variables.update).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('archives a variable and audits the action', async () => {
      variables.findById.mockResolvedValue(buildVariable());
      variables.update.mockResolvedValue(buildVariable({ status: 'ARCHIVED' }));

      const result = await service.setStatus(orgId, 'variable_1', 'ARCHIVED', 'actor_1');

      expect(variables.update).toHaveBeenCalledWith('variable_1', { status: 'ARCHIVED' });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'variable.archive' }),
      );
      expect(result.status).toBe('ARCHIVED');
    });

    it('restores an archived variable back to ACTIVE', async () => {
      variables.findById.mockResolvedValue(buildVariable({ status: 'ARCHIVED' }));
      variables.update.mockResolvedValue(buildVariable({ status: 'ACTIVE' }));

      await service.setStatus(orgId, 'variable_1', 'ACTIVE', 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'variable.restore' }),
      );
    });
  });

  describe('remove', () => {
    it('deletes a variable that has never been referenced', async () => {
      variables.findById.mockResolvedValue(buildVariable());

      await service.remove(orgId, 'variable_1', 'actor_1');

      expect(variables.remove).toHaveBeenCalledWith('variable_1');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'variable.delete', metadata: { key: 'nombre' } }),
      );
    });

    it('rejects deleting a variable referenced in a sequence step', async () => {
      variables.findById.mockResolvedValue(buildVariable());
      sequenceSteps.findAllByOrganization.mockResolvedValue([
        buildStep({ htmlBody: '<p>Hola {nombre}</p>' }),
      ]);

      await expect(service.remove(orgId, 'variable_1', 'actor_1')).rejects.toThrow(
        BadRequestException,
      );
      expect(variables.remove).not.toHaveBeenCalled();
    });

    it('rejects deleting a variable referenced in an active signature version', async () => {
      variables.findById.mockResolvedValue(buildVariable());
      signatures.findAllByOrganization.mockResolvedValue([buildSignature()]);
      signatureVersions.findById.mockResolvedValue(
        buildSignatureVersion({ htmlContent: '<p>Saludos, {nombre}</p>' }),
      );

      await expect(service.remove(orgId, 'variable_1', 'actor_1')).rejects.toThrow(
        BadRequestException,
      );
      expect(variables.remove).not.toHaveBeenCalled();
    });

    it('ignores a signature with no active version yet', async () => {
      variables.findById.mockResolvedValue(buildVariable());
      signatures.findAllByOrganization.mockResolvedValue([
        buildSignature({ activeVersionId: null }),
      ]);

      await service.remove(orgId, 'variable_1', 'actor_1');

      expect(signatureVersions.findById).not.toHaveBeenCalled();
      expect(variables.remove).toHaveBeenCalledWith('variable_1');
    });

    it('throws NotFoundException for a variable in a different organization (never 403)', async () => {
      variables.findById.mockResolvedValue(buildVariable({ organizationId: otherOrgId }));

      await expect(service.remove(orgId, 'variable_1', 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(variables.remove).not.toHaveBeenCalled();
    });
  });

  describe('getById / list', () => {
    it('never returns a variable from a different organization', async () => {
      variables.findById.mockResolvedValue(buildVariable({ organizationId: otherOrgId }));

      await expect(service.getById(orgId, 'variable_1')).rejects.toThrow(NotFoundException);
    });

    it('list returns summaries for every variable in the organization', async () => {
      variables.findAll.mockResolvedValue([buildVariable(), buildVariable({ id: 'variable_2' })]);

      const result = await service.list(orgId);

      expect(result).toHaveLength(2);
      expect(variables.findAll).toHaveBeenCalledWith(orgId);
    });
  });
});
