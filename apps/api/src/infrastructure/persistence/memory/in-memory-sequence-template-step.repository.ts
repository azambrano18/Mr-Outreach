import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceTemplateStepInput,
  SequenceTemplateStep,
  UpdateSequenceTemplateStepInput,
} from '../../../domain/sequence-template/sequence-template-step.entity';
import { SequenceTemplateStepRepository } from '../../../domain/sequence-template/sequence-template-step.repository';
import { MemoryStore } from './memory-store';

const DEFAULT_WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;

@Injectable()
export class InMemorySequenceTemplateStepRepository implements SequenceTemplateStepRepository {
  constructor(private readonly store: MemoryStore) {}

  async findByTemplate(templateId: string): Promise<SequenceTemplateStep[]> {
    return [...this.store.sequenceTemplateSteps.values()]
      .filter((step) => step.templateId === templateId)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }

  async findById(id: string): Promise<SequenceTemplateStep | null> {
    return this.store.sequenceTemplateSteps.get(id) ?? null;
  }

  async create(input: CreateSequenceTemplateStepInput): Promise<SequenceTemplateStep> {
    const now = new Date();
    const step: SequenceTemplateStep = {
      id: randomUUID(),
      organizationId: input.organizationId,
      templateId: input.templateId,
      stepNumber: input.stepNumber,
      name: input.name,
      enabled: true,
      subjectTemplate: '',
      headerHtml: null,
      headerText: null,
      bodyHtml: '',
      bodyText: '',
      delayValue: input.stepNumber === 1 ? 0 : 5,
      delayUnit: 'BUSINESS_DAYS',
      delayReference: input.stepNumber === 1 ? 'EXECUTION_START' : 'PREVIOUS_STEP',
      // §1-3 — fixed, non-configurable: Mon-Fri, 08:00-19:00 (Envío 1's start is dynamic — resolved from the Gestión's own effective start, not this column; sendWindowStart here is an unused sentinel for it).
      allowedWeekdays: [...DEFAULT_WEEKDAYS],
      sendWindowStart: input.stepNumber === 1 ? '00:00' : '08:00',
      sendWindowEnd: '19:00',
      createdAt: now,
      updatedAt: now,
    };
    this.store.sequenceTemplateSteps.set(step.id, step);
    return step;
  }

  async update(id: string, input: UpdateSequenceTemplateStepInput): Promise<SequenceTemplateStep> {
    const existing = this.store.sequenceTemplateSteps.get(id);
    if (!existing) throw new Error(`SequenceTemplateStep ${id} not found`);
    // A key present with value `undefined` means "not sent, leave unchanged" (mirrors Prisma's own
    // undefined-skipping semantics) — e.g. the service always sends delayValue/delayUnit as `undefined`
    // for Envío 1, which must not wipe whatever was previously stored there.
    const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const updated: SequenceTemplateStep = { ...existing, ...definedInput, updatedAt: new Date() };
    this.store.sequenceTemplateSteps.set(id, updated);
    return updated;
  }

  async deleteByTemplate(templateId: string): Promise<void> {
    for (const step of this.store.sequenceTemplateSteps.values()) {
      if (step.templateId === templateId) this.store.sequenceTemplateSteps.delete(step.id);
    }
  }
}
