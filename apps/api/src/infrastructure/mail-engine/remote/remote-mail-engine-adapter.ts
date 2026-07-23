import { Injectable, Logger } from '@nestjs/common';
import { CommandEnvelope } from '../../../domain/integration/envelopes';
import { MailEnginePort } from '../../../domain/integration/mail-engine-port';

/**
 * §2: "El `RemoteMailEngineAdapter` puede quedar como implementación
 * preparada, incompleta o deshabilitada, pero con su contrato claramente
 * definido." This adapter exists so `MAIL_ENGINE_MODE=remote` is a real,
 * selectable configuration — not so it actually reaches a real engine yet.
 * Every method fails loudly rather than pretending to succeed, so nobody
 * mistakes `remote` mode for a working integration before the real HTTP/
 * message-bus client is built.
 */
@Injectable()
export class RemoteMailEngineAdapter implements MailEnginePort {
  private readonly logger = new Logger(RemoteMailEngineAdapter.name);

  async submitCommand(command: CommandEnvelope): Promise<{ accepted: boolean }> {
    this.logger.warn(
      `RemoteMailEngineAdapter.submitCommand called for ${command.commandType} but no remote engine is configured.`,
    );
    throw new Error(
      'RemoteMailEngineAdapter no está implementado todavía. Use MAIL_ENGINE_MODE=simulation.',
    );
  }

  async getCommandStatus(): Promise<string | null> {
    throw new Error('RemoteMailEngineAdapter no está implementado todavía.');
  }

  async getMailboxStatus(): Promise<Record<string, unknown> | null> {
    throw new Error('RemoteMailEngineAdapter no está implementado todavía.');
  }

  async getImportStatus(): Promise<string | null> {
    throw new Error('RemoteMailEngineAdapter no está implementado todavía.');
  }

  async getSequenceStatus(): Promise<Record<string, unknown> | null> {
    throw new Error('RemoteMailEngineAdapter no está implementado todavía.');
  }
}
