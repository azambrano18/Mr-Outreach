import { NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Template } from '../../domain/template/template.entity';
import { TemplateRepository } from '../../domain/template/template.repository';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  let templates: jest.Mocked<TemplateRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let service: TemplatesService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildTemplate = (overrides: Partial<Template> = {}): Template => ({
    id: 'template_1',
    organizationId: orgId,
    name: 'Primer contacto',
    subject: 'Hola {nombre}',
    body: 'Hola {nombre}, te escribo de {empresa}. Un saludo, {nombre}.',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    templates = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };

    service = new TemplatesService(templates, auditLogs);
  });

  describe('toSummary (via getById)', () => {
    it('extracts the unique variables from subject and body, deduplicated and in first-seen order', async () => {
      templates.findById.mockResolvedValue(buildTemplate());

      const result = await service.getById(orgId, 'template_1');

      expect(result.variables).toEqual(['nombre', 'empresa']);
    });

    it('throws NotFoundException for a template in a different organization (never 403)', async () => {
      templates.findById.mockResolvedValue(buildTemplate({ organizationId: otherOrgId }));

      await expect(service.getById(orgId, 'template_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('persists the template and records an audit entry', async () => {
      templates.create.mockResolvedValue(buildTemplate());

      const result = await service.create(
        orgId,
        { name: 'Primer contacto', subject: 'Hola {nombre}', body: 'Cuerpo' },
        'actor_1',
      );

      expect(templates.create).toHaveBeenCalledWith({
        organizationId: orgId,
        name: 'Primer contacto',
        subject: 'Hola {nombre}',
        body: 'Cuerpo',
      });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'template.create' }),
      );
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      templates.findById.mockResolvedValue(buildTemplate());
      templates.update.mockResolvedValue(buildTemplate({ name: 'Renombrada' }));

      await service.update(orgId, 'template_1', { name: 'Renombrada' }, 'actor_1');

      expect(templates.update).toHaveBeenCalledWith('template_1', { name: 'Renombrada' });
    });

    it('throws NotFoundException for a template in a different organization', async () => {
      templates.findById.mockResolvedValue(buildTemplate({ organizationId: otherOrgId }));

      await expect(service.update(orgId, 'template_1', { name: 'X' }, 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(templates.update).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('creates a copy with a "(copia)" suffix, never mutating the source', async () => {
      templates.findById.mockResolvedValue(buildTemplate());
      templates.create.mockResolvedValue(
        buildTemplate({ id: 'template_2', name: 'Primer contacto (copia)' }),
      );

      const result = await service.duplicate(orgId, 'template_1', 'actor_1');

      expect(templates.create).toHaveBeenCalledWith({
        organizationId: orgId,
        name: 'Primer contacto (copia)',
        subject: 'Hola {nombre}',
        body: 'Hola {nombre}, te escribo de {empresa}. Un saludo, {nombre}.',
      });
      expect(templates.update).not.toHaveBeenCalled();
      expect(result.id).toBe('template_2');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'template.duplicate',
          metadata: { sourceTemplateId: 'template_1' },
        }),
      );
    });
  });

  describe('setStatus', () => {
    it('archives a template and audits the action', async () => {
      templates.findById.mockResolvedValue(buildTemplate());
      templates.update.mockResolvedValue(buildTemplate({ status: 'ARCHIVED' }));

      const result = await service.setStatus(orgId, 'template_1', 'ARCHIVED', 'actor_1');

      expect(templates.update).toHaveBeenCalledWith('template_1', { status: 'ARCHIVED' });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'template.archive' }),
      );
      expect(result.status).toBe('ARCHIVED');
    });

    it('restores an archived template back to ACTIVE', async () => {
      templates.findById.mockResolvedValue(buildTemplate({ status: 'ARCHIVED' }));
      templates.update.mockResolvedValue(buildTemplate({ status: 'ACTIVE' }));

      await service.setStatus(orgId, 'template_1', 'ACTIVE', 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'template.restore' }),
      );
    });
  });

  describe('softDelete', () => {
    it('soft-deletes and audits the action', async () => {
      templates.findById.mockResolvedValue(buildTemplate());

      await service.softDelete(orgId, 'template_1', 'actor_1');

      expect(templates.softDelete).toHaveBeenCalledWith('template_1');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'template.delete' }),
      );
    });

    it('throws NotFoundException for a template in a different organization, without deleting', async () => {
      templates.findById.mockResolvedValue(buildTemplate({ organizationId: otherOrgId }));

      await expect(service.softDelete(orgId, 'template_1', 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(templates.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns summaries for every template in the organization', async () => {
      templates.findAll.mockResolvedValue([buildTemplate(), buildTemplate({ id: 'template_2' })]);

      const result = await service.list(orgId);

      expect(result).toHaveLength(2);
      expect(templates.findAll).toHaveBeenCalledWith(orgId);
    });
  });
});
