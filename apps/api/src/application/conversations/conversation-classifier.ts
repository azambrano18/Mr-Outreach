import { ConversationClassification } from '../../domain/conversation/conversation.entity';
import { ConversationMessageType } from '../../domain/conversation/conversation-message.entity';

export interface ClassificationResult {
  classification: ConversationClassification;
  messageType: ConversationMessageType;
}

/**
 * Deterministic, rule-based classification — no AI, no randomness (per
 * §17 of the client-hierarchy spec: "para el MVP, priorizar reglas
 * determinísticas y clasificación manual"). Matches on normalized
 * (lowercased, accent-stripped) subject + snippet text. Falls through to
 * UNCLASSIFIED/HUMAN_REPLY (never silently guesses a commercial outcome)
 * when nothing matches — those end up in "Mensajes sin identificar" only
 * if their mailbox is also unclassified; otherwise they're just a normal
 * conversation an executive has to classify by hand.
 */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const RULES: Array<{
  keywords: string[];
  classification: ConversationClassification;
  messageType: ConversationMessageType;
}> = [
  {
    keywords: ['fuera de la oficina', 'fuera de oficina', 'out of office', 'respuesta automatica'],
    classification: 'OUT_OF_OFFICE',
    messageType: 'OUT_OF_OFFICE',
  },
  {
    keywords: [
      'unsubscribe',
      'dar de baja',
      'darme de baja',
      'no contactar',
      'cancelar suscripcion',
    ],
    classification: 'UNSUBSCRIBE',
    messageType: 'UNSUBSCRIBE',
  },
  {
    keywords: ['mailer-daemon', 'undeliverable', 'delivery failed', 'no pudo entregar'],
    classification: 'HARD_BOUNCE',
    messageType: 'HARD_BOUNCE',
  },
  {
    keywords: ['no estamos interesados', 'no nos interesa', 'no me interesa', 'no es el momento'],
    classification: 'NOT_INTERESTED',
    messageType: 'HUMAN_REPLY',
  },
  {
    keywords: [
      'contacto equivocado',
      'persona equivocada',
      'ya no trabajo',
      'contactar a otra persona',
    ],
    classification: 'WRONG_CONTACT',
    messageType: 'HUMAN_REPLY',
  },
  {
    keywords: ['agendar', 'llamada', 'reunion', 'cuentame mas', 'interesante', 'me interesa'],
    classification: 'INTERESTED',
    messageType: 'HUMAN_REPLY',
  },
  {
    keywords: ['consulta', 'integracion', 'como funciona', 'mas informacion', 'precio', 'plan'],
    classification: 'REQUESTS_INFORMATION',
    messageType: 'HUMAN_REPLY',
  },
];

export function classifyInboundMessage(subject: string, snippet: string): ClassificationResult {
  const haystack = normalize(`${subject} ${snippet}`);
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return { classification: rule.classification, messageType: rule.messageType };
    }
  }
  return { classification: 'UNCLASSIFIED', messageType: 'HUMAN_REPLY' };
}
