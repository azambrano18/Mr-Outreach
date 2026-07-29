import { BadRequestException, ConflictException, GoneException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailboxMotorPort } from '../../../domain/mailbox-motor/mailbox-motor-port';
import {
  MailboxLinkRedemption,
  MailboxLinkTokenInfo,
  MailboxLinkTokenStatus,
  MailboxMotorClientInfo,
  MailboxMotorDomainInfo,
  MailboxMotorMailboxInfo,
  MailboxTechnicalStatus,
  RedeemMailboxLinkTokenInput,
  ServerMailboxRevocation,
  ServerMailboxStatus,
  UnlinkServerMailboxInput,
} from '../../../domain/mailbox-motor/mailbox-motor.types';

/** §27 — scenario controls for issuing a fixture token, used by tests, e2e and the integration monitor's simulation controls. Never used by real production traffic (there is no "real" here). */
export interface IssueLinkTokenInput {
  email: string;
  displayName: string;
  domainName: string;
  clientName: string;
  crmClientId?: number | null;
  mailboxStatus?: MailboxTechnicalStatus;
  canSend?: boolean;
  /** Defaults to a normal, valid, freshly-issued token. */
  scenario?: 'VALID' | 'EXPIRED' | 'REVOKED';
  expiresInHours?: number;
}

interface TokenRecord {
  tokenId: string;
  status: MailboxLinkTokenStatus;
  expiresAt: Date;
  mailbox: MailboxMotorMailboxInfo;
  domain: MailboxMotorDomainInfo;
  client: MailboxMotorClientInfo;
  /** Keyed by the requesting Mr Outreach organizationId — supports same-org idempotent replay and cross-org 409. */
  redemptions: Map<string, MailboxLinkRedemption>;
}

interface MailboxRegistryEntry {
  info: MailboxMotorMailboxInfo;
  linkStatus: 'ACTIVE' | 'REVOKED';
}

/** §27 — a fingerprint safe to show in the integration monitor; never the token itself. */
export function fingerprintToken(token: string): string {
  const tail = token.slice(-4);
  return `tok_****${tail}`;
}

/**
 * §5/§27 — the only adapter used by automated tests and this phase's manual
 * validation. No network call happens anywhere in this class; every
 * "server-side" decision comes from a scenario explicitly chosen via
 * `issueLinkToken`/`setMailboxTechnicalStatus`/`setMotorUnavailable`/
 * `setUnlinkOutcome`, exactly the same simulation philosophy already
 * applied by `SimulatedMailEngineAdapter`.
 */
@Injectable()
export class SimulatedMailboxMotorAdapter implements MailboxMotorPort {
  private readonly tokensByValue = new Map<string, TokenRecord>();
  private readonly mailboxRegistry = new Map<string, MailboxRegistryEntry>();
  private readonly unlinkOutcomes = new Map<string, 'SUCCESS' | 'FAILURE'>();
  private motorUnavailable = false;

  /** Global outage switch — affects every method identically, mirroring a real motor being unreachable. */
  setMotorUnavailable(unavailable: boolean): void {
    this.motorUnavailable = unavailable;
  }

  setMailboxTechnicalStatus(serverMailboxId: string, status: MailboxTechnicalStatus, canSend?: boolean): void {
    const entry = this.mailboxRegistry.get(serverMailboxId);
    if (!entry) return;
    entry.info = { ...entry.info, status, canSend: canSend ?? entry.info.canSend };
  }

  setUnlinkOutcome(serverMailboxId: string, outcome: 'SUCCESS' | 'FAILURE'): void {
    this.unlinkOutcomes.set(serverMailboxId, outcome);
  }

  /** Fixture creation — the simulated equivalent of "the motor generated a 24h, single-use token". */
  issueLinkToken(input: IssueLinkTokenInput): string {
    const tokenId = `tok_${randomUUID()}`;
    const token = `mmt_${randomUUID()}`;
    const scenario = input.scenario ?? 'VALID';
    const expiresInHours = input.expiresInHours ?? 24;
    const serverMailboxId = `mbx_${randomUUID()}`;
    const mailbox: MailboxMotorMailboxInfo = {
      serverMailboxId,
      email: input.email,
      displayName: input.displayName,
      status: input.mailboxStatus ?? 'CONNECTED',
      canSend: input.canSend ?? true,
    };
    const domain: MailboxMotorDomainInfo = { serverDomainId: `dom_${randomUUID()}`, name: input.domainName };
    const client: MailboxMotorClientInfo = {
      serverClientId: `client_${randomUUID()}`,
      crmClientId: input.crmClientId ?? null,
      name: input.clientName,
    };

    const expiresAt =
      scenario === 'EXPIRED'
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    this.tokensByValue.set(token, {
      tokenId,
      status: scenario === 'REVOKED' ? 'REVOKED' : scenario === 'EXPIRED' ? 'EXPIRED' : 'ISSUED',
      expiresAt,
      mailbox,
      domain,
      client,
      redemptions: new Map(),
    });
    this.mailboxRegistry.set(serverMailboxId, { info: mailbox, linkStatus: 'ACTIVE' });
    return token;
  }

  private requireMotorAvailable(): void {
    if (this.motorUnavailable) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }
  }

  private currentStatus(record: TokenRecord): MailboxLinkTokenStatus {
    if (record.status === 'REVOKED') return 'REVOKED';
    if (record.redemptions.size > 0) return 'REDEEMED';
    if (record.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
    return 'ISSUED';
  }

  async introspectLinkToken(token: string): Promise<MailboxLinkTokenInfo> {
    this.requireMotorAvailable();
    const record = this.tokensByValue.get(token);
    if (!record) {
      throw new BadRequestException('Token de vinculación inválido.');
    }
    const status = this.currentStatus(record);
    return {
      valid: status === 'ISSUED',
      tokenId: record.tokenId,
      status,
      expiresAt: record.expiresAt,
      mailbox: record.mailbox,
      domain: record.domain,
      client: record.client,
    };
  }

  async redeemLinkToken(input: RedeemMailboxLinkTokenInput): Promise<MailboxLinkRedemption> {
    this.requireMotorAvailable();
    const record = this.tokensByValue.get(input.token);
    if (!record) {
      throw new BadRequestException('Token de vinculación inválido.');
    }

    const existingForThisOrg = record.redemptions.get(input.requestingOrganizationId);
    if (existingForThisOrg) {
      return existingForThisOrg;
    }

    if (record.redemptions.size > 0) {
      // Redeemed already, but by a different organization.
      throw new ConflictException('Este token ya fue redimido por otra organización.');
    }

    const status = this.currentStatus(record);
    if (status === 'REVOKED' || status === 'EXPIRED') {
      throw new GoneException(status === 'REVOKED' ? 'Este token fue revocado.' : 'Este token venció.');
    }

    const redemption: MailboxLinkRedemption = {
      redemptionId: `red_${randomUUID()}`,
      tokenId: record.tokenId,
      status: 'REDEEMED',
      redeemedAt: new Date(),
      mailbox: record.mailbox,
      domain: record.domain,
      client: record.client,
    };
    record.redemptions.set(input.requestingOrganizationId, redemption);
    return redemption;
  }

  async getMailboxStatus(serverMailboxId: string): Promise<ServerMailboxStatus> {
    this.requireMotorAvailable();
    const entry = this.mailboxRegistry.get(serverMailboxId);
    if (!entry) {
      throw new BadRequestException('Cuenta de correo desconocida para el motor.');
    }
    return {
      serverMailboxId,
      linkStatus: entry.linkStatus,
      technicalStatus: entry.info.status,
      canSend: entry.info.canSend,
      checkedAt: new Date(),
    };
  }

  async unlinkMailbox(input: UnlinkServerMailboxInput): Promise<ServerMailboxRevocation> {
    this.requireMotorAvailable();
    const entry = this.mailboxRegistry.get(input.serverMailboxId);
    if (!entry) {
      throw new BadRequestException('Cuenta de correo desconocida para el motor.');
    }

    // Idempotent: already revoked — return a fresh receipt, never re-derive a different one.
    const outcome = this.unlinkOutcomes.get(input.serverMailboxId) ?? 'SUCCESS';
    if (outcome === 'FAILURE') {
      throw new ServiceUnavailableException('El motor no pudo confirmar la revocación en este intento.');
    }

    entry.linkStatus = 'REVOKED';
    return {
      serverMailboxId: input.serverMailboxId,
      status: 'REVOKED',
      revocationId: `rev_${randomUUID()}`,
      revokedAt: new Date(),
    };
  }
}
