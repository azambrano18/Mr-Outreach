/**
 * §7 — relative scheduling, never an absolute date. EXECUTION_START means
 * "relative to the Gestión's real start date" (only meaningful for step 1);
 * PREVIOUS_STEP means "relative to the previous step's own computed time".
 */
export type SequenceTemplateStepDelayReference = 'EXECUTION_START' | 'PREVIOUS_STEP';

export type SequenceTemplateStepDelayUnit = 'MINUTES' | 'HOURS' | 'CALENDAR_DAYS' | 'BUSINESS_DAYS';

export type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/**
 * Exactly three rows always exist per SequenceTemplate (stepNumber 1..3),
 * created together with the template and never individually added/removed
 * — mirrors the FIXED_3 constraint SequenceStepsService already enforces
 * for the legacy Sequence entity, but per-step scheduling (§7) here instead
 * of one schedule shared by the whole template.
 */
export interface SequenceTemplateStep {
  id: string;
  organizationId: string;
  templateId: string;
  stepNumber: 1 | 2 | 3;
  name: string;
  enabled: boolean;
  subjectTemplate: string;
  /** Vestigial — never read/written; superseded by headerText below. */
  headerHtml: string | null;
  /** §4 (revised) — individual, optional, plain-text header for this envío. */
  headerText: string | null;
  bodyHtml: string;
  bodyText: string;
  delayValue: number;
  delayUnit: SequenceTemplateStepDelayUnit;
  delayReference: SequenceTemplateStepDelayReference;
  allowedWeekdays: Weekday[];
  sendWindowStart: string;
  sendWindowEnd: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequenceTemplateStepInput {
  organizationId: string;
  templateId: string;
  stepNumber: 1 | 2 | 3;
  name: string;
}

export interface UpdateSequenceTemplateStepInput {
  name?: string;
  enabled?: boolean;
  subjectTemplate?: string;
  headerText?: string | null;
  bodyHtml?: string;
  bodyText?: string;
  delayValue?: number;
  delayUnit?: SequenceTemplateStepDelayUnit;
  delayReference?: SequenceTemplateStepDelayReference;
  allowedWeekdays?: Weekday[];
  sendWindowStart?: string;
  sendWindowEnd?: string;
}
