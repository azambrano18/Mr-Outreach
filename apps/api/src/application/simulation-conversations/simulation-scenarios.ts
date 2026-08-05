import { ResponseOutcome } from '../../domain/conversation/conversation.entity';

/**
 * §9/§6 — the 4 fixed scenarios "Conversaciones de prueba" always
 * generates, in this exact order. `replyText` is the exact wording the
 * task requires; `scenario` is only a SUGGESTED hint (`simulationScenario`
 * on the Conversation) — the admin can classify any of the 4 with any of
 * the 4 ResponseOutcome values, since the whole point is exercising real
 * system behavior, not validating automatic intelligence (§10).
 */
export interface SimulationScenarioConfig {
  scenario: ResponseOutcome;
  label: string;
  email: string;
  firstName: string;
  lastName: string;
  replyText: string;
}

export const OUTBOUND_SUBJECT = 'Prueba QA — Mr Outreach';
export const OUTBOUND_BODY =
  'Este es un mensaje simulado utilizado exclusivamente para validar el flujo de conversaciones y clasificación de respuestas.';

export const QA_CLIENT_NAME = 'Mr Outreach — Pruebas de conversación';
export const QA_COMPANY_NAME = 'Mr Outreach — Pruebas de conversación';

export const SCENARIOS: SimulationScenarioConfig[] = [
  {
    scenario: 'INTERESTED',
    label: 'Prueba — Interesado',
    email: 'interesado@conversation-test.invalid',
    firstName: 'Prueba',
    lastName: 'Interesado',
    replyText:
      'Hola, gracias por contactarme. Me interesa conocer más sobre la propuesta y podríamos coordinar una reunión esta semana.',
  },
  {
    scenario: 'NOT_INTERESTED',
    label: 'Prueba — No interesado',
    email: 'no-interesado@conversation-test.invalid',
    firstName: 'Prueba',
    lastName: 'No Interesado',
    replyText: 'Gracias por escribir. En este momento no estamos interesados en avanzar con este servicio.',
  },
  {
    scenario: 'DO_NOT_CONTACT',
    label: 'Prueba — No contactar',
    email: 'no-contactar@conversation-test.invalid',
    firstName: 'Prueba',
    lastName: 'No Contactar',
    replyText: 'Por favor eliminen mi correo de sus registros y no vuelvan a contactarme.',
  },
  {
    scenario: 'REFERRED',
    label: 'Prueba — Deriva',
    email: 'deriva@conversation-test.invalid',
    firstName: 'Prueba',
    lastName: 'Deriva',
    replyText: 'Hola. Yo no veo estos temas, pero puedes comunicarte con la persona responsable del área comercial.',
  },
];
