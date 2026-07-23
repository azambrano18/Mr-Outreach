import { InMemorySequenceStepRepository } from './in-memory-sequence-step.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceStepRepository', () => {
  const baseInput = {
    organizationId: 'org_1',
    sequenceId: 'sequence_1',
    subject: 'Asunto',
    htmlBody: '<p>Cuerpo</p>',
    plainTextBody: 'Cuerpo',
    delayValue: 0,
    delayUnit: 'DAYS' as const,
    sendMode: 'NEW_THREAD' as const,
    createdBy: 'admin_1',
  };

  it('creates a step in DRAFT status', async () => {
    const repo = new InMemorySequenceStepRepository(new MemoryStore());

    const step = await repo.create({ ...baseInput, position: 1, name: 'Step 1' });

    expect(step.status).toBe('DRAFT');
    expect(step.position).toBe(1);
  });

  it('findBySequence returns steps ordered by position ascending', async () => {
    const repo = new InMemorySequenceStepRepository(new MemoryStore());
    await repo.create({ ...baseInput, position: 2, name: 'Step 2' });
    await repo.create({ ...baseInput, position: 1, name: 'Step 1' });

    const steps = await repo.findBySequence('sequence_1');

    expect(steps.map((s) => s.name)).toEqual(['Step 1', 'Step 2']);
  });

  it('remove soft-deletes — findById and findBySequence no longer return it', async () => {
    const repo = new InMemorySequenceStepRepository(new MemoryStore());
    const step = await repo.create({ ...baseInput, position: 1, name: 'Step 1' });

    await repo.remove(step.id);

    expect(await repo.findById(step.id)).toBeNull();
    expect(await repo.findBySequence('sequence_1')).toHaveLength(0);
  });

  it('update patches only the provided fields', async () => {
    const repo = new InMemorySequenceStepRepository(new MemoryStore());
    const step = await repo.create({ ...baseInput, position: 1, name: 'Step 1' });

    const updated = await repo.update(step.id, { subject: 'Nuevo asunto' });

    expect(updated.subject).toBe('Nuevo asunto');
    expect(updated.htmlBody).toBe('<p>Cuerpo</p>');
  });
});
