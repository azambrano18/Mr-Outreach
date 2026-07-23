import { classifyInboundMessage } from './conversation-classifier';

describe('classifyInboundMessage', () => {
  it('classifies an out-of-office auto-reply', () => {
    const result = classifyInboundMessage(
      'Fuera de la oficina — respuesta automática',
      'Estaré fuera de la oficina hasta el lunes.',
    );
    expect(result).toEqual({ classification: 'OUT_OF_OFFICE', messageType: 'OUT_OF_OFFICE' });
  });

  it('classifies an unsubscribe request', () => {
    const result = classifyInboundMessage('Quiero darme de baja', 'Por favor no me contacten más.');
    expect(result).toEqual({ classification: 'UNSUBSCRIBE', messageType: 'UNSUBSCRIBE' });
  });

  it('classifies a hard bounce', () => {
    const result = classifyInboundMessage('Mail delivery failed', 'Undeliverable: mailbox full.');
    expect(result).toEqual({ classification: 'HARD_BOUNCE', messageType: 'HARD_BOUNCE' });
  });

  it('classifies an explicit rejection as NOT_INTERESTED, still a real human reply', () => {
    const result = classifyInboundMessage(
      'No estamos interesados por ahora',
      'Gracias por contactarnos, pero no es el momento.',
    );
    expect(result).toEqual({ classification: 'NOT_INTERESTED', messageType: 'HUMAN_REPLY' });
  });

  it('classifies interest signals as INTERESTED', () => {
    const result = classifyInboundMessage(
      'Re: Propuesta de automatización',
      '¿Podríamos agendar una llamada esta semana?',
    );
    expect(result).toEqual({ classification: 'INTERESTED', messageType: 'HUMAN_REPLY' });
  });

  it('classifies a question about the product as REQUESTS_INFORMATION', () => {
    const result = classifyInboundMessage(
      'Consulta sobre integración',
      '¿La plataforma se integra con Salesforce?',
    );
    expect(result).toEqual({ classification: 'REQUESTS_INFORMATION', messageType: 'HUMAN_REPLY' });
  });

  it('is accent-insensitive (café vs cafe style normalization)', () => {
    const result = classifyInboundMessage('Reunión y más información', 'Cuéntame más, por favor.');
    expect(result.messageType).toBe('HUMAN_REPLY');
    expect(result.classification).not.toBe('UNCLASSIFIED');
  });

  it('falls through to UNCLASSIFIED/HUMAN_REPLY for unrecognized content rather than guessing', () => {
    const result = classifyInboundMessage('Saludos desde el equipo', 'Todo bien por aquí.');
    expect(result).toEqual({ classification: 'UNCLASSIFIED', messageType: 'HUMAN_REPLY' });
  });
});
