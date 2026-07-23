import { CommandEnvelope } from './envelopes';

/**
 * §46. The rest of the application depends on this port, never on
 * `SimulatedMailEngineAdapter`/`RemoteMailEngineAdapter` directly — the
 * same rule this codebase already applies to `EngineClient`
 * (domain/engine/engine-client.ts), `MailboxRepository`, etc.
 *
 * `submitCommand`/`getCommandStatus`/`getMailboxStatus`/`getImportStatus`/
 * `getSequenceStatus` are the polling-shaped operations §46 asks for —
 * meaningful for a real remote engine reached over HTTP. The simulated
 * adapter satisfies the contract but does its real work through
 * `planEvents` instead (see SimulatedMailEngineAdapter's own doc comment):
 * there is no network round-trip to poll when the "remote" system is
 * in-process, so `IntegrationService` drives progression directly rather
 * than polling status.
 */
export interface MailEnginePort {
  submitCommand(command: CommandEnvelope): Promise<{ accepted: boolean }>;
  getCommandStatus(commandId: string): Promise<string | null>;
  getMailboxStatus(mailboxId: string): Promise<Record<string, unknown> | null>;
  getImportStatus(importId: string): Promise<string | null>;
  getSequenceStatus(sequenceId: string): Promise<Record<string, unknown> | null>;
}

export const MAIL_ENGINE_PORT = Symbol('MAIL_ENGINE_PORT');
