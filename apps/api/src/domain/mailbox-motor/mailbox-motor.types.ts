/**
 * Fase 2.1 — the shapes `MailboxMotorPort` and both its adapters speak.
 * Mirrors the engine-server split already established for
 * `domain/integration/envelopes.ts`: these are the contracts a real remote
 * motor would use too, not simulation-only shapes. See
 * `docs/motor-mailbox-link-contract-v1.md` for the versioned HTTP contract
 * this models.
 *
 * None of these types carry a token value, a password, or any other secret
 * — see MailboxMotorPort's own doc comment for why.
 */

export type MailboxTechnicalStatus = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'DISABLED' | 'UNKNOWN';

export type MailboxLinkTokenStatus = 'ISSUED' | 'EXPIRED' | 'REVOKED' | 'REDEEMED';

export interface MailboxMotorMailboxInfo {
  serverMailboxId: string;
  email: string;
  displayName: string;
  status: MailboxTechnicalStatus;
  canSend: boolean;
}

export interface MailboxMotorDomainInfo {
  serverDomainId: string;
  name: string;
}

export interface MailboxMotorClientInfo {
  serverClientId: string;
  name: string;
}

/** Result of `introspectLinkToken` — always returned, never thrown, for any recognized token regardless of its current status (§4.1). */
export interface MailboxLinkTokenInfo {
  valid: boolean;
  tokenId: string;
  status: MailboxLinkTokenStatus;
  expiresAt: Date;
  mailbox: MailboxMotorMailboxInfo;
  domain: MailboxMotorDomainInfo;
  client: MailboxMotorClientInfo;
}

export interface RedeemMailboxLinkTokenInput {
  /** Kept in memory only by the caller — see MailboxMotorPort's doc comment. */
  token: string;
  idempotencyKey: string;
  requestingOrganizationId: string;
  actorId: string;
}

export interface MailboxLinkRedemption {
  redemptionId: string;
  tokenId: string;
  status: 'REDEEMED';
  redeemedAt: Date;
  mailbox: MailboxMotorMailboxInfo;
  domain: MailboxMotorDomainInfo;
  client: MailboxMotorClientInfo;
}

export interface ServerMailboxStatus {
  serverMailboxId: string;
  linkStatus: 'ACTIVE' | 'REVOKED';
  technicalStatus: MailboxTechnicalStatus;
  canSend: boolean;
  checkedAt: Date;
}

export interface UnlinkServerMailboxInput {
  serverMailboxId: string;
  idempotencyKey: string;
  requestingOrganizationId: string;
  actorId: string;
  reason: string;
  correlationId: string;
}

export interface ServerMailboxRevocation {
  serverMailboxId: string;
  status: 'REVOKED';
  revocationId: string;
  revokedAt: Date;
}
