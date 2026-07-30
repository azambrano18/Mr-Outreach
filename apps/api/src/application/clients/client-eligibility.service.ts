import { ConflictException, Injectable } from '@nestjs/common';
import { ClientStatusPolicy } from '../../domain/client/client-status.policy';
import { ManagedClient } from '../../domain/client/managed-client.entity';

/**
 * The single, centralized place that decides whether a `ManagedClient` is
 * eligible for new activity (new domains/mailboxes/sequences/assignments).
 * Replaces `CrmClientEligibilityService` — same business rule (block
 * operations on an inactive client), different data source: no external
 * system is consulted live anymore, only the client's own local record.
 *
 * Deliberately has NO side effects: no ManagedClient writes, no snapshot
 * updates, no audit, no transaction.
 */
@Injectable()
export class ClientEligibilityService {
  constructor(private readonly policy: ClientStatusPolicy) {}

  /** Throws ConflictException (409) if the client isn't eligible for new activity. */
  assertEligible(client: ManagedClient): void {
    if (!this.policy.isEligible(client)) {
      throw new ConflictException('Este cliente está inactivo y no admite nuevas configuraciones.');
    }
  }

  /**
   * Same check as `assertEligible`, reserved for the higher-stakes gates
   * (publicar una Plantilla, iniciar una Gestión). Async today only
   * because there is, as of yet, no defined contract for asking the
   * external server for a client's live status — this currently
   * evaluates the local snapshot exactly like `assertEligible`. TODO:
   * once the motor/Railway server exposes a live client-status endpoint,
   * call it here before falling back to the local snapshot.
   */
  async assertEligibleForPublish(client: ManagedClient): Promise<void> {
    this.assertEligible(client);
  }
}
