export type SequenceTemplateStepNumber = 1 | 2 | 3;

export interface SequenceTemplateStepUIVisibility {
  showSignatureEditor: boolean;
  showPublishAction: boolean;
  showArchiveAction: boolean;
  showDeleteAction: boolean;
}

/**
 * The signature (owned by the mailbox, never by a step) and the
 * Plantilla-wide actions (Publicar, Archivar, Eliminar) all affect the
 * ENTIRE Plantilla, never a single envío — so each is shown exactly once,
 * only inside Envío 1. Envíos 2 and 3 must never repeat them: no duplicate
 * signature editor, no duplicate destructive buttons, no independent state
 * per step. This is the single source of truth `SequenceTemplateEditor`
 * reads from for that gating — kept here, pure and framework-free, so the
 * rule itself is testable without rendering React.
 */
export function getSequenceTemplateStepVisibility(stepNumber: SequenceTemplateStepNumber): SequenceTemplateStepUIVisibility {
  const isFirstStep = stepNumber === 1;
  return {
    showSignatureEditor: isFirstStep,
    showPublishAction: isFirstStep,
    showArchiveAction: isFirstStep,
    showDeleteAction: isFirstStep,
  };
}
