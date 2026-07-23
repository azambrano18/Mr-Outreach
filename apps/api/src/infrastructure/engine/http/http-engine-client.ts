import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  EngineClient,
  EngineHealthStatus,
  FetchInboxInput,
  FetchInboxResult,
  FetchThreadInput,
  FetchThreadResult,
  SendMailInput,
  SendMailResult,
  SetThreadReadInput,
  SetThreadReadResult,
  TestMailboxInput,
  TestMailboxResult,
} from '../../../domain/engine/engine-client';

/**
 * Only ever constructed when ENGINE_DRIVER=http — see EngineModule. Talks
 * to the (separately developed) execution engine over plain HTTP/fetch,
 * never Axios, so the app carries one fewer dependency for something the
 * runtime already provides.
 *
 * The exact route names below follow the engine API sketched during
 * architecture planning (POST /mailboxes/test) and may need to be
 * adjusted once the engine team publishes its real contract — this
 * adapter is the only place that would need to change.
 */
@Injectable()
export class HttpEngineClient implements EngineClient {
  private readonly logger = new Logger(HttpEngineClient.name);
  private readonly timeoutMs = 10_000;

  constructor(private readonly config: AppConfigService) {}

  async testMailbox(input: TestMailboxInput): Promise<TestMailboxResult> {
    const response = await this.request('/mailboxes/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return {
        status: 'ENGINE_UNAVAILABLE',
        imap: { success: false, errorCode: 'ENGINE_HTTP_ERROR' },
        smtp: { success: false, errorCode: 'ENGINE_HTTP_ERROR' },
        testedAt: new Date().toISOString(),
      };
    }

    return (await response.json()) as TestMailboxResult;
  }

  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    const response = await this.request('/mailboxes/send-test', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return { accepted: false, errorCode: 'ENGINE_HTTP_ERROR' };
    }

    return (await response.json()) as SendMailResult;
  }

  async checkHealth(): Promise<EngineHealthStatus> {
    try {
      const response = await this.request('/health', { method: 'GET' });
      return response.ok ? 'available' : 'unavailable';
    } catch {
      // Never log the raw error: it can embed the engine's host/port.
      this.logger.warn('Engine health check failed.');
      return 'unavailable';
    }
  }

  async fetchInbox(input: FetchInboxInput): Promise<FetchInboxResult> {
    const response = await this.request('/mailboxes/inbox', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return { status: 'ENGINE_UNAVAILABLE', threads: [] };
    }

    return (await response.json()) as FetchInboxResult;
  }

  async fetchThread(input: FetchThreadInput): Promise<FetchThreadResult> {
    const response = await this.request('/mailboxes/inbox/thread', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return { status: 'ENGINE_UNAVAILABLE', messages: [] };
    }

    return (await response.json()) as FetchThreadResult;
  }

  async setThreadReadState(input: SetThreadReadInput): Promise<SetThreadReadResult> {
    const response = await this.request('/mailboxes/inbox/thread/read-state', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return { status: 'ENGINE_UNAVAILABLE' };
    }

    return (await response.json()) as SetThreadReadResult;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const baseUrl = this.config.engineBaseUrl;
    if (!baseUrl) {
      throw new Error('ENGINE_BASE_URL is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.engineApiKey
            ? { Authorization: `Bearer ${this.config.engineApiKey}` }
            : {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
