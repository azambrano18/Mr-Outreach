import { InMemorySequenceStepVersionRepository } from './in-memory-sequence-step-version.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceStepVersionRepository', () => {
  const baseInput = {
    subject: 'Asunto',
    preheader: null,
    htmlBody: '<p>Cuerpo</p>',
    plainTextBody: 'Cuerpo',
    delayValue: 0,
    delayUnit: 'DAYS' as const,
    sendMode: 'NEW_THREAD' as const,
    createdBy: 'admin_1',
  };

  it('numbers versions incrementally per step, independently per step', async () => {
    const repo = new InMemorySequenceStepVersionRepository(new MemoryStore());

    const v1 = await repo.create({ ...baseInput, sequenceStepId: 'step_1' });
    const v2 = await repo.create({ ...baseInput, sequenceStepId: 'step_1' });
    const otherFirst = await repo.create({ ...baseInput, sequenceStepId: 'step_2' });

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
    expect(otherFirst.versionNumber).toBe(1);
  });

  it('findByStep returns most recent first, scoped to that step', async () => {
    const repo = new InMemorySequenceStepVersionRepository(new MemoryStore());
    const v1 = await repo.create({ ...baseInput, sequenceStepId: 'step_1' });
    const v2 = await repo.create({ ...baseInput, sequenceStepId: 'step_1' });

    const history = await repo.findByStep('step_1');

    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(v2.id);
    expect(history[1].id).toBe(v1.id);
  });
});
