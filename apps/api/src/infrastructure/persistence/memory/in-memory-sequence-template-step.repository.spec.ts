import { InMemorySequenceTemplateStepRepository } from './in-memory-sequence-template-step.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceTemplateStepRepository', () => {
  let store: MemoryStore;
  let repo: InMemorySequenceTemplateStepRepository;

  beforeEach(() => {
    store = new MemoryStore();
    repo = new InMemorySequenceTemplateStepRepository(store);
  });

  it('update() does not wipe delayValue/delayUnit when the caller sends them as undefined (Envío 1)', async () => {
    const step = await repo.create({ organizationId: 'org-1', templateId: 'tpl-1', stepNumber: 1, name: 'Envío 1' });
    // Envío 1's schedule fields start at their seeded defaults (delayValue 0, delayUnit BUSINESS_DAYS).

    // Mirrors a body-only PATCH on Envío 1: the service always sends delayValue/delayUnit as `undefined`.
    const updated = await repo.update(step.id, {
      bodyHtml: '<p>Cuerpo</p>',
      delayValue: undefined,
      delayUnit: undefined,
    });

    expect(updated.bodyHtml).toBe('<p>Cuerpo</p>');
    expect(updated.delayValue).toBe(step.delayValue);
    expect(updated.delayUnit).toBe(step.delayUnit);
  });
});
