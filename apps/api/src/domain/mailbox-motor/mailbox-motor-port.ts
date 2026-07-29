import {
  MailboxLinkRedemption,
  MailboxLinkTokenInfo,
  RedeemMailboxLinkTokenInput,
  ServerMailboxRevocation,
  ServerMailboxStatus,
  UnlinkServerMailboxInput,
} from './mailbox-motor.types';

/**
 * Fase 2.1 — the rest of the application depends on this port, never on
 * `SimulatedMailboxMotorAdapter`/`HttpMailboxMotorAdapter` directly, same
 * rule already applied to `MailEnginePort`.
 *
 * This is a DIFFERENT external system from `MailEnginePort`: the motor here
 * owns account registration, IMAP/SMTP/OAuth credentials, their encryption,
 * connection testing, and link-token issuance — Mr Outreach never holds
 * those secrets for a `SERVER_TOKEN` mailbox. `MailEnginePort` still owns
 * sending/sequence execution and is unaffected by this port.
 *
 * Callers must never persist the raw token value anywhere (log, database,
 * audit, idempotent result) — only `tokenId`/`redemptionId`/a fingerprint.
 * Implementations throw the same typed Nest exceptions
 * `CrmClientEligibilityService` already established for an external-system
 * port (`NotFoundException`/`ConflictException`/`GoneException`/
 * `ServiceUnavailableException`), so callers never need their own
 * try/catch translation layer.
 */
export interface MailboxMotorPort {
  /**
   * Read-only. Never redeems, never creates anything. Returns a result
   * object (never throws) for any token the motor recognizes, regardless of
   * its current status — `valid`/`status` tell the caller why it can't be
   * used. Throws `BadRequestException` only for a malformed/unrecognized
   * token, and `ServiceUnavailableException` if the motor can't be reached.
   */
  introspectLinkToken(token: string): Promise<MailboxLinkTokenInfo>;

  /**
   * Throws `GoneException` (410) if the token is expired/revoked,
   * `ConflictException` (409) if already redeemed by a DIFFERENT
   * organization, `BadRequestException` for a malformed token, and
   * `ServiceUnavailableException` if the motor can't be reached. If already
   * redeemed by the SAME `requestingOrganizationId` (same or a retried
   * `idempotencyKey`), returns the identical existing receipt instead of
   * throwing — never creates a second redemption or a second account.
   */
  redeemLinkToken(input: RedeemMailboxLinkTokenInput): Promise<MailboxLinkRedemption>;

  /**
   * Throws `ServiceUnavailableException` if the motor can't be reached —
   * callers must treat that as fail-closed, never fall back to a cached
   * snapshot to authorize an operation.
   */
  getMailboxStatus(serverMailboxId: string): Promise<ServerMailboxStatus>;

  /**
   * Idempotent: a second call with the same `idempotencyKey` (or against an
   * already-`REVOKED` mailbox) returns the same revocation receipt rather
   * than erroring. Throws `ServiceUnavailableException` if the motor can't
   * be reached — callers must leave the local link in `UNLINK_REQUESTED`
   * and allow retrying, never mark it `REVOKED` on a failed call.
   */
  unlinkMailbox(input: UnlinkServerMailboxInput): Promise<ServerMailboxRevocation>;
}

export const MAILBOX_MOTOR_PORT = Symbol('MAILBOX_MOTOR_PORT');
