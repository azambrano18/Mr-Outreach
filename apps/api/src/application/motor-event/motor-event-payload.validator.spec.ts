import { validateMotorEventPayload } from './motor-event-payload.validator';

describe('validateMotorEventPayload', () => {
  it('EXECUTION_ACCEPTED requires serverExecutionId', () => {
    expect(validateMotorEventPayload('EXECUTION_ACCEPTED', {}).valid).toBe(false);
    expect(validateMotorEventPayload('EXECUTION_ACCEPTED', { serverExecutionId: 'srv_1' }).valid).toBe(true);
  });

  it('EXECUTION_PROCESSING has no required fields', () => {
    expect(validateMotorEventPayload('EXECUTION_PROCESSING', {}).valid).toBe(true);
  });

  it('OUTBOUND_MESSAGE_CREATED requires all core message fields', () => {
    const result = validateMotorEventPayload('OUTBOUND_MESSAGE_CREATED', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'payload.outboundMessageId es obligatorio.',
        'payload.mailboxId es obligatorio.',
        'payload.prospectImportRowId es obligatorio.',
        'payload.recipientEmail es obligatorio.',
        'payload.subject es obligatorio.',
        'payload.htmlBody es obligatorio.',
        'payload.plainTextBody es obligatorio.',
      ]),
    );
  });

  it('OUTBOUND_MESSAGE_CREATED accepts a complete payload with a numeric stepNumber', () => {
    const result = validateMotorEventPayload('OUTBOUND_MESSAGE_CREATED', {
      outboundMessageId: 'out_1',
      mailboxId: 'mbx_1',
      prospectImportRowId: 'row_1',
      recipientEmail: 'a@b.test',
      subject: 'Hola',
      htmlBody: '<p>Hola</p>',
      plainTextBody: 'Hola',
      stepNumber: 1,
    });
    expect(result.valid).toBe(true);
  });

  it('OUTBOUND_MESSAGE_CREATED rejects a non-numeric stepNumber', () => {
    const result = validateMotorEventPayload('OUTBOUND_MESSAGE_CREATED', {
      outboundMessageId: 'out_1',
      mailboxId: 'mbx_1',
      prospectImportRowId: 'row_1',
      recipientEmail: 'a@b.test',
      subject: 'Hola',
      htmlBody: '<p>Hola</p>',
      plainTextBody: 'Hola',
      stepNumber: 'uno',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('payload.stepNumber debe ser un número cuando está presente.');
  });

  it('OUTBOUND_MESSAGE_SENT requires outboundMessageId', () => {
    expect(validateMotorEventPayload('OUTBOUND_MESSAGE_SENT', {}).valid).toBe(false);
    expect(validateMotorEventPayload('OUTBOUND_MESSAGE_SENT', { outboundMessageId: 'out_1' }).valid).toBe(true);
  });

  it('INBOUND_MESSAGE_RECEIVED requires mailboxId, emailMessageId, senderEmail, subject and bodies', () => {
    const result = validateMotorEventPayload('INBOUND_MESSAGE_RECEIVED', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(6);

    expect(
      validateMotorEventPayload('INBOUND_MESSAGE_RECEIVED', {
        mailboxId: 'mbx_1',
        emailMessageId: 'msg_1',
        senderEmail: 'prospecto@empresa.test',
        subject: 'Re: Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
      }).valid,
    ).toBe(true);
  });

  it('EXECUTION_COMPLETED has no required fields', () => {
    expect(validateMotorEventPayload('EXECUTION_COMPLETED', {}).valid).toBe(true);
  });

  it('EXECUTION_FAILED requires errorMessage', () => {
    expect(validateMotorEventPayload('EXECUTION_FAILED', {}).valid).toBe(false);
    expect(validateMotorEventPayload('EXECUTION_FAILED', { errorMessage: 'boom' }).valid).toBe(true);
  });

  it('FUTURE_JOBS_CANCELLED requires either contactId or companyId', () => {
    expect(validateMotorEventPayload('FUTURE_JOBS_CANCELLED', {}).valid).toBe(false);
    expect(validateMotorEventPayload('FUTURE_JOBS_CANCELLED', { contactId: 'contact_1' }).valid).toBe(true);
    expect(validateMotorEventPayload('FUTURE_JOBS_CANCELLED', { companyId: 'company_1' }).valid).toBe(true);
  });

  it('rejects blank-string fields the same way as missing fields (whitespace-only is not a value)', () => {
    const result = validateMotorEventPayload('EXECUTION_ACCEPTED', { serverExecutionId: '   ' });
    expect(result.valid).toBe(false);
  });
});
