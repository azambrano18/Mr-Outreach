import { MotorEventType } from '../../modules/integration/dto/motor-event-envelope.dto';

export interface MotorEventPayloadValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireStrings(payload: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => !isNonEmptyString(payload[field])).map((field) => `payload.${field} es obligatorio.`);
}

/**
 * Fase "Recepción de eventos del motor" — the "DTO específico" per
 * eventType Fase 5 asks for, implemented as a plain, unit-testable function
 * rather than a class-validator discriminated union (matches this
 * codebase's existing convention for payload-shape checks, e.g.
 * validateTemplateVariables in @outreach/validation). Only the fields the
 * projector cannot proceed without are required — everything else is
 * optional and defaults are applied downstream.
 */
export function validateMotorEventPayload(
  eventType: MotorEventType,
  payload: Record<string, unknown>,
): MotorEventPayloadValidationResult {
  let errors: string[] = [];

  switch (eventType) {
    case 'EXECUTION_ACCEPTED':
      errors = requireStrings(payload, ['serverExecutionId']);
      break;
    case 'EXECUTION_PROCESSING':
      break;
    case 'OUTBOUND_MESSAGE_CREATED':
      errors = requireStrings(payload, [
        'outboundMessageId',
        'mailboxId',
        'prospectImportRowId',
        'recipientEmail',
        'subject',
        'htmlBody',
        'plainTextBody',
      ]);
      if (payload.stepNumber !== undefined && typeof payload.stepNumber !== 'number') {
        errors.push('payload.stepNumber debe ser un número cuando está presente.');
      }
      break;
    case 'OUTBOUND_MESSAGE_SENT':
      errors = requireStrings(payload, ['outboundMessageId']);
      break;
    case 'INBOUND_MESSAGE_RECEIVED':
      errors = requireStrings(payload, ['mailboxId', 'emailMessageId', 'senderEmail', 'subject', 'htmlBody', 'plainTextBody']);
      break;
    case 'EXECUTION_COMPLETED':
      break;
    case 'EXECUTION_FAILED':
      errors = requireStrings(payload, ['errorMessage']);
      break;
    case 'FUTURE_JOBS_CANCELLED':
      if (!isNonEmptyString(payload.contactId) && !isNonEmptyString(payload.companyId)) {
        errors.push('payload.contactId o payload.companyId es obligatorio.');
      }
      break;
    case 'EXECUTION_PAUSE_ACCEPTED':
    case 'EXECUTION_PAUSED':
    case 'EXECUTION_RESUME_ACCEPTED':
    case 'EXECUTION_RESUMED':
    case 'EXECUTION_STOP_ACCEPTED':
      break;
    case 'EXECUTION_STOPPED':
      errors = requireStrings(payload, ['reason']);
      break;
    default: {
      const exhaustive: never = eventType;
      errors.push(`Tipo de evento desconocido: ${String(exhaustive)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
