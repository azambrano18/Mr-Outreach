import { ManagedClient } from './managed-client.entity';

/**
 * Pure policy: decides whether a `ManagedClient` is eligible for new
 * activity (new domains/mailboxes/sequences/assignments), using only data
 * already stored locally on the row — no I/O, no dependencies. Replaces
 * `CrmClientEligibilityService.isActive()`, which compared a live CRM
 * status string; the same comparison now runs against the local
 * `externalStatusSnapshot` the last time it was refreshed.
 */
/** Until a live external-verification contract exists (see ClientEligibilityService), nothing populates externalStatusSnapshot — this comparison is a placeholder for the day something does. */
const EXTERNAL_ACTIVE_VALUE = 'ACTIVO';

export class ClientStatusPolicy {
  isEligible(client: ManagedClient): boolean {
    if (client.status !== 'ACTIVE') {
      return false;
    }
    // No external status has ever been reported for this client (e.g. a
    // fresh SERVER-origin client) — the local operational status alone
    // authorizes it.
    if (client.externalStatusSnapshot === null) {
      return true;
    }
    return client.externalStatusSnapshot.trim().toUpperCase() === EXTERNAL_ACTIVE_VALUE;
  }
}
