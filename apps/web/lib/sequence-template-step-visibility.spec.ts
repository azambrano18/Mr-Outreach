import { getSequenceTemplateStepVisibility } from './sequence-template-step-visibility';

describe('getSequenceTemplateStepVisibility', () => {
  it('Envío 1 shows the signature editor', () => {
    expect(getSequenceTemplateStepVisibility(1).showSignatureEditor).toBe(true);
  });

  it('Envío 2 hides the signature editor', () => {
    expect(getSequenceTemplateStepVisibility(2).showSignatureEditor).toBe(false);
  });

  it('Envío 3 hides the signature editor', () => {
    expect(getSequenceTemplateStepVisibility(3).showSignatureEditor).toBe(false);
  });

  it('Envío 1 shows Publicar plantilla', () => {
    expect(getSequenceTemplateStepVisibility(1).showPublishAction).toBe(true);
  });

  it('Envío 1 shows Archivar plantilla', () => {
    expect(getSequenceTemplateStepVisibility(1).showArchiveAction).toBe(true);
  });

  it('Envío 1 shows Eliminar plantilla', () => {
    expect(getSequenceTemplateStepVisibility(1).showDeleteAction).toBe(true);
  });

  it.each([2, 3] as const)(
    'Envío %i hides every global template action (Publicar, Archivar, Eliminar)',
    (step) => {
      const visibility = getSequenceTemplateStepVisibility(step);
      expect(visibility.showPublishAction).toBe(false);
      expect(visibility.showArchiveAction).toBe(false);
      expect(visibility.showDeleteAction).toBe(false);
    },
  );

  it('Envío 1 returns the complete visibility object with everything enabled', () => {
    expect(getSequenceTemplateStepVisibility(1)).toEqual({
      showSignatureEditor: true,
      showPublishAction: true,
      showArchiveAction: true,
      showDeleteAction: true,
    });
  });

  it.each([2, 3] as const)('Envío %i returns the complete visibility object with everything disabled', (step) => {
    expect(getSequenceTemplateStepVisibility(step)).toEqual({
      showSignatureEditor: false,
      showPublishAction: false,
      showArchiveAction: false,
      showDeleteAction: false,
    });
  });
});
