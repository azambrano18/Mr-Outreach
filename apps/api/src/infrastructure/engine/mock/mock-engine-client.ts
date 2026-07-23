import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EngineClient,
  EngineHealthStatus,
  FetchInboxInput,
  FetchInboxResult,
  FetchThreadInput,
  FetchThreadResult,
  InboxFetchStatus,
  InboxMessageResult,
  InboxThreadResult,
  SendMailInput,
  SendMailResult,
  SetThreadReadInput,
  SetThreadReadResult,
  TestMailboxInput,
  TestMailboxResult,
} from '../../../domain/engine/engine-client';

export type MailboxTestScenario =
  | 'CONNECTED'
  | 'CREDENTIALS_ERROR'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'IMAP_UNAVAILABLE'
  | 'SMTP_UNAVAILABLE'
  | 'PARTIALLY_CONNECTED'
  | 'ENGINE_UNAVAILABLE';

const SCENARIO_RESULTS: Record<MailboxTestScenario, Omit<TestMailboxResult, 'testedAt'>> = {
  CONNECTED: {
    status: 'CONNECTED',
    imap: { success: true },
    smtp: { success: true },
  },
  PARTIALLY_CONNECTED: {
    status: 'PARTIALLY_CONNECTED',
    imap: { success: true },
    smtp: { success: false, errorCode: 'SMTP_AUTH_FAILED' },
  },
  CREDENTIALS_ERROR: {
    status: 'CONNECTION_ERROR',
    imap: { success: false, errorCode: 'IMAP_AUTH_FAILED' },
    smtp: { success: false, errorCode: 'SMTP_AUTH_FAILED' },
  },
  TIMEOUT: {
    status: 'CONNECTION_ERROR',
    imap: { success: false, errorCode: 'IMAP_TIMEOUT' },
    smtp: { success: false, errorCode: 'SMTP_TIMEOUT' },
  },
  TLS_ERROR: {
    status: 'CONNECTION_ERROR',
    imap: { success: false, errorCode: 'IMAP_TLS_ERROR' },
    smtp: { success: false, errorCode: 'SMTP_TLS_ERROR' },
  },
  IMAP_UNAVAILABLE: {
    status: 'PARTIALLY_CONNECTED',
    imap: { success: false, errorCode: 'IMAP_UNAVAILABLE' },
    smtp: { success: true },
  },
  SMTP_UNAVAILABLE: {
    status: 'PARTIALLY_CONNECTED',
    imap: { success: true },
    smtp: { success: false, errorCode: 'SMTP_UNAVAILABLE' },
  },
  ENGINE_UNAVAILABLE: {
    status: 'ENGINE_UNAVAILABLE',
    imap: { success: false, errorCode: 'ENGINE_UNAVAILABLE' },
    smtp: { success: false, errorCode: 'ENGINE_UNAVAILABLE' },
  },
};

/**
 * Lets a QA person or an admin trigger a specific scenario through the
 * real UI, without any extra endpoint: register the mailbox's email with
 * a "+tag" local-part, e.g. "ventas+timeout@example.com". No effect on
 * real mail delivery — Mailbox.email is only ever used as a lookup key
 * here.
 */
const EMAIL_TAG_SCENARIOS: Record<string, MailboxTestScenario> = {
  credenciales: 'CREDENTIALS_ERROR',
  credentials: 'CREDENTIALS_ERROR',
  timeout: 'TIMEOUT',
  tls: 'TLS_ERROR',
  imapdown: 'IMAP_UNAVAILABLE',
  smtpdown: 'SMTP_UNAVAILABLE',
  parcial: 'PARTIALLY_CONNECTED',
  partial: 'PARTIALLY_CONNECTED',
  motorcaido: 'ENGINE_UNAVAILABLE',
  enginedown: 'ENGINE_UNAVAILABLE',
};

function scenarioFromEmailTag(email: string): MailboxTestScenario | undefined {
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  const tag = localPart.split('+')[1];
  return tag ? EMAIL_TAG_SCENARIOS[tag] : undefined;
}

export type SendMailScenario = 'ACCEPTED' | 'REJECTED' | 'BOUNCED';

const SEND_TAG_SCENARIOS: Record<string, SendMailScenario> = {
  bounce: 'BOUNCED',
  rebote: 'BOUNCED',
  reject: 'REJECTED',
  rechazo: 'REJECTED',
};

function sendScenarioFromEmailTag(email: string): SendMailScenario | undefined {
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  const tag = localPart.split('+')[1];
  return tag ? SEND_TAG_SCENARIOS[tag] : undefined;
}

/**
 * Deterministic by design — no randomness. Resolution order for a given
 * call: (1) a scenario explicitly registered via setScenario(), (2) the
 * "+tag" convention on the email above, (3) a successful connection.
 */
@Injectable()
export class MockEngineClient implements EngineClient {
  private readonly scenarios = new Map<string, MailboxTestScenario>();

  setScenario(email: string, scenario: MailboxTestScenario): void {
    this.scenarios.set(email.toLowerCase(), scenario);
  }

  clearScenarios(): void {
    this.scenarios.clear();
  }

  async testMailbox(input: TestMailboxInput): Promise<TestMailboxResult> {
    const scenario =
      this.scenarios.get(input.email.toLowerCase()) ??
      scenarioFromEmailTag(input.email) ??
      'CONNECTED';
    return { ...SCENARIO_RESULTS[scenario], testedAt: new Date().toISOString() };
  }

  /**
   * Same "+tag" convention as testMailbox, applied to the recipient
   * ("to") instead of the mailbox's own email, so a QA person can force a
   * bounce/reject scenario without touching mailbox configuration —
   * e.g. sending a test to "prueba+bounce@example.com".
   */
  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    const scenario = sendScenarioFromEmailTag(input.to) ?? 'ACCEPTED';

    if (scenario === 'REJECTED') {
      return { accepted: false, smtpResponseCode: '550', errorCode: 'SMTP_RECIPIENT_REJECTED' };
    }
    if (scenario === 'BOUNCED') {
      // Accepted by SMTP, "bounces" asynchronously — out of scope for a
      // synchronous mock, so this scenario just returns success too; the
      // tag exists for forward-compatibility with a future real engine.
      return { accepted: true, smtpResponseCode: '250', messageId: randomUUID() };
    }
    return { accepted: true, smtpResponseCode: '250', messageId: randomUUID() };
  }

  async checkHealth(): Promise<EngineHealthStatus> {
    return 'available';
  }

  /**
   * Reuses the exact same "+tag" convention as testMailbox — a QA person
   * can force `ventas+timeout@example.com` to make both the connection
   * test AND the inbox read fail the same way, without two conventions
   * to remember.
   */
  async fetchInbox(input: FetchInboxInput): Promise<FetchInboxResult> {
    const status = this.inboxStatusFromEmail(input.email);
    if (status !== 'OK') {
      return { status, threads: [] };
    }
    const threads = demoThreadsForMailbox(input.email).map((thread) => {
      const override = this.readOverrides.get(this.readOverrideKey(input.email, thread.id));
      if (override === undefined) return thread;
      return { ...thread, unreadCount: override ? Math.max(thread.unreadCount, 1) : 0 };
    });
    return { status: 'OK', threads };
  }

  async fetchThread(input: FetchThreadInput): Promise<FetchThreadResult> {
    const status = this.inboxStatusFromEmail(input.email);
    if (status !== 'OK') {
      return { status, messages: [] };
    }
    const messages = demoMessagesForThread(input.email, input.threadId);
    if (messages.length === 0) {
      return { status: 'NOT_FOUND', messages: [] };
    }
    const override = this.readOverrides.get(this.readOverrideKey(input.email, input.threadId));
    const adjusted =
      override === undefined
        ? messages
        : messages.map((message, index) =>
            index === messages.length - 1 ? { ...message, isUnread: override } : message,
          );
    return { status: 'OK', messages: adjusted };
  }

  /**
   * In-memory only (resets on server restart), same as `scenarios` above
   * — there is no real message store yet, so "mark as read/unread" can
   * only be a demo-quality toggle layered on top of the deterministic
   * generated threads, not a durable read receipt.
   */
  async setThreadReadState(input: SetThreadReadInput): Promise<SetThreadReadResult> {
    const status = this.inboxStatusFromEmail(input.email);
    if (status !== 'OK') {
      return { status };
    }
    const threads = demoThreadsForMailbox(input.email);
    if (!threads.some((thread) => thread.id === input.threadId)) {
      return { status: 'NOT_FOUND' };
    }
    this.readOverrides.set(this.readOverrideKey(input.email, input.threadId), input.isUnread);
    return { status: 'OK' };
  }

  private inboxStatusFromEmail(email: string): InboxFetchStatus {
    const scenario = this.scenarios.get(email.toLowerCase()) ?? scenarioFromEmailTag(email);
    if (!scenario || scenario === 'CONNECTED') return 'OK';
    if (scenario === 'ENGINE_UNAVAILABLE') return 'ENGINE_UNAVAILABLE';
    return 'CONNECTION_ERROR';
  }

  private readonly readOverrides = new Map<string, boolean>();

  private readOverrideKey(email: string, threadId: string): string {
    return `${email.toLowerCase()}|${threadId}`;
  }
}

/**
 * Deterministic by design, same as the rest of this mock — no randomness,
 * no persistence. A small fixed pool of demo threads, rotated by a
 * cheap hash of the mailbox's own email so different demo mailboxes show
 * different (but stable across calls) inboxes.
 */
const DEMO_THREAD_POOL: Array<{
  subject: string;
  participant: { name: string; email: string };
  snippet: string;
  bodyHtml: string;
  messageCount: number;
  unreadCount: number;
  ageHours: number;
}> = [
  {
    subject: 'Re: Propuesta de automatización de prospección',
    participant: { name: 'Camila Torres', email: 'camila.torres@prospecto-demo.test' },
    snippet: 'Gracias por el detalle, ¿podríamos agendar una llamada esta semana?',
    bodyHtml:
      '<p>Hola,</p><p>Gracias por el detalle, ¿podríamos agendar una llamada esta semana?</p><p>Saludos,<br>Camila</p>',
    messageCount: 3,
    unreadCount: 1,
    ageHours: 2,
  },
  {
    subject: 'Consulta sobre integración con nuestro CRM',
    participant: { name: 'Diego Fuentes', email: 'diego.fuentes@prospecto-demo.test' },
    snippet: '¿La plataforma se integra con Salesforce o solo con HubSpot?',
    bodyHtml:
      '<p>Hola,</p><p>¿La plataforma se integra con Salesforce o solo con HubSpot?</p><p>Diego</p>',
    messageCount: 1,
    unreadCount: 1,
    ageHours: 20,
  },
  {
    subject: 'Fuera de la oficina — respuesta automática',
    participant: { name: 'Valentina Rojas', email: 'valentina.rojas@prospecto-demo.test' },
    snippet: 'Estaré fuera de la oficina hasta el lunes. Para urgencias, contactar a...',
    bodyHtml:
      '<p>Estaré fuera de la oficina hasta el lunes. Para urgencias, contactar a soporte@prospecto-demo.test.</p>',
    messageCount: 1,
    unreadCount: 0,
    ageHours: 30,
  },
  {
    subject: 'Re: Una consulta para Empresa Ejemplo S.A.',
    participant: { name: 'Juan Pérez', email: 'juan.perez@prospecto-demo.test' },
    snippet: 'Interesante, cuéntame más sobre el plan para equipos pequeños.',
    bodyHtml:
      '<p>Hola,</p><p>Interesante, cuéntame más sobre el plan para equipos pequeños.</p><p>Juan</p>',
    messageCount: 2,
    unreadCount: 0,
    ageHours: 50,
  },
  {
    subject: 'No estamos interesados por ahora',
    participant: { name: 'Roberto Salazar', email: 'roberto.salazar@prospecto-demo.test' },
    snippet: 'Gracias por contactarnos, pero no es el momento para evaluar esto.',
    bodyHtml:
      '<p>Gracias por contactarnos, pero no es el momento para evaluar esto.</p><p>Saludos.</p>',
    messageCount: 1,
    unreadCount: 0,
    ageHours: 75,
  },
];

function hashEmail(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function slugFromEmail(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function demoThreadsForMailbox(email: string): InboxThreadResult[] {
  const offset = hashEmail(email) % DEMO_THREAD_POOL.length;
  const slug = slugFromEmail(email);
  const rotated = [...DEMO_THREAD_POOL.slice(offset), ...DEMO_THREAD_POOL.slice(0, offset)];
  const now = Date.now();

  return rotated.map((template, index) => ({
    id: `${slug}-thread-${index + 1}`,
    subject: template.subject,
    participants: [template.participant],
    lastMessageAt: new Date(now - template.ageHours * 60 * 60 * 1000).toISOString(),
    lastMessageSnippet: template.snippet,
    unreadCount: template.unreadCount,
    messageCount: template.messageCount,
  }));
}

function demoMessagesForThread(email: string, threadId: string): InboxMessageResult[] {
  const threads = demoThreadsForMailbox(email);
  const threadIndex = threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex === -1) return [];

  const offset = hashEmail(email) % DEMO_THREAD_POOL.length;
  const rotated = [...DEMO_THREAD_POOL.slice(offset), ...DEMO_THREAD_POOL.slice(0, offset)];
  const template = rotated[threadIndex];
  const now = Date.now();

  const messages: InboxMessageResult[] = [];
  for (let i = 0; i < template.messageCount; i += 1) {
    const isLast = i === template.messageCount - 1;
    const direction: InboxMessageResult['direction'] = i % 2 === 0 ? 'OUTBOUND' : 'INBOUND';
    messages.push({
      id: `${threadId}-msg-${i + 1}`,
      threadId,
      from:
        direction === 'OUTBOUND'
          ? { name: null, email }
          : { name: template.participant.name, email: template.participant.email },
      to:
        direction === 'OUTBOUND'
          ? [{ name: template.participant.name, email: template.participant.email }]
          : [{ name: null, email }],
      subject: template.subject,
      bodyHtml: isLast
        ? template.bodyHtml
        : `<p>${template.subject}</p><p>(mensaje anterior del hilo de demostración)</p>`,
      bodyText: isLast ? template.snippet : `${template.subject} (mensaje anterior)`,
      direction,
      isUnread: isLast && template.unreadCount > 0,
      receivedAt: new Date(now - (template.ageHours - i * 2) * 60 * 60 * 1000).toISOString(),
    });
  }
  return messages;
}
