import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
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

interface WireMailbox {
  serverMailboxId: string;
  email: string;
  displayName: string;
  status: MailboxTechnicalStatus;
  canSend: boolean;
}

interface WireDomain {
  serverDomainId: string;
  name: string;
}

interface WireClient {
  serverClientId: string;
  crmClientId: number | null;
  name: string;
}

interface WireIntrospectResponse {
  valid: boolean;
  tokenId: string;
  status: MailboxLinkTokenStatus;
  expiresAt: string;
  mailbox: WireMailbox;
  domain: WireDomain;
  client: WireClient;
}

interface WireRedeemResponse {
  redemptionId: string;
  tokenId: string;
  status: 'REDEEMED';
  redeemedAt: string;
  mailbox: WireMailbox;
  domain: WireDomain;
  client: WireClient;
}

interface WireStatusResponse {
  serverMailboxId: string;
  linkStatus: 'ACTIVE' | 'REVOKED';
  technicalStatus: MailboxTechnicalStatus;
  canSend: boolean;
  checkedAt: string;
}

interface WireRevocationResponse {
  serverMailboxId: string;
  status: 'REVOKED';
  revocationId: string;
  revokedAt: string;
}

function toMailboxInfo(w: WireMailbox): MailboxMotorMailboxInfo {
  return { serverMailboxId: w.serverMailboxId, email: w.email, displayName: w.displayName, status: w.status, canSend: w.canSend };
}

function toDomainInfo(w: WireDomain): MailboxMotorDomainInfo {
  return { serverDomainId: w.serverDomainId, name: w.name };
}

function toClientInfo(w: WireClient): MailboxMotorClientInfo {
  return { serverClientId: w.serverClientId, crmClientId: w.crmClientId, name: w.name };
}

/**
 * Fase 2.1, §6-9 — real implementation of the contract in
 * `docs/motor-mailbox-link-contract-v1.md`. Only ever constructed when
 * MAILBOX_MOTOR_DRIVER=http (see MailboxMotorModule); no HTTP detail
 * (routes, headers, status-code mapping) leaks past this class — every
 * method returns/throws exactly what `MailboxMotorPort`'s own doc comment
 * promises, identical to `SimulatedMailboxMotorAdapter`.
 *
 * Every request carries `Authorization: Bearer <MAILBOX_MOTOR_API_KEY>` —
 * a credential entirely separate from the mailbox-link token itself, which
 * this adapter never sends to the motor as a bearer/auth credential, only
 * ever as the request body's `token` field.
 */
@Injectable()
export class HttpMailboxMotorAdapter implements MailboxMotorPort {
  private readonly logger = new Logger(HttpMailboxMotorAdapter.name);

  constructor(private readonly config: AppConfigService) {}

  async introspectLinkToken(token: string): Promise<MailboxLinkTokenInfo> {
    const response = await this.request('/v1/mailbox-link-tokens/introspect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const body = await this.parseJson<WireIntrospectResponse>(response);
    return {
      valid: body.valid,
      tokenId: body.tokenId,
      status: body.status,
      expiresAt: new Date(body.expiresAt),
      mailbox: toMailboxInfo(body.mailbox),
      domain: toDomainInfo(body.domain),
      client: toClientInfo(body.client),
    };
  }

  async redeemLinkToken(input: RedeemMailboxLinkTokenInput): Promise<MailboxLinkRedemption> {
    const response = await this.request(
      '/v1/mailbox-link-tokens/redeem',
      {
        method: 'POST',
        body: JSON.stringify({
          token: input.token,
          organizationId: input.requestingOrganizationId,
          requestedBy: input.actorId,
        }),
      },
      { idempotencyKey: input.idempotencyKey },
    );
    const body = await this.parseJson<WireRedeemResponse>(response);
    return {
      redemptionId: body.redemptionId,
      tokenId: body.tokenId,
      status: body.status,
      redeemedAt: new Date(body.redeemedAt),
      mailbox: toMailboxInfo(body.mailbox),
      domain: toDomainInfo(body.domain),
      client: toClientInfo(body.client),
    };
  }

  async getMailboxStatus(serverMailboxId: string): Promise<ServerMailboxStatus> {
    const response = await this.request(`/v1/mailboxes/${encodeURIComponent(serverMailboxId)}/status`, {
      method: 'GET',
    });
    const body = await this.parseJson<WireStatusResponse>(response);
    return {
      serverMailboxId: body.serverMailboxId,
      linkStatus: body.linkStatus,
      technicalStatus: body.technicalStatus,
      canSend: body.canSend,
      checkedAt: new Date(body.checkedAt),
    };
  }

  async unlinkMailbox(input: UnlinkServerMailboxInput): Promise<ServerMailboxRevocation> {
    const response = await this.request(
      `/v1/mailboxes/${encodeURIComponent(input.serverMailboxId)}/unlink`,
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: input.requestingOrganizationId,
          actorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
        }),
      },
      { idempotencyKey: input.idempotencyKey, correlationId: input.correlationId },
    );
    const body = await this.parseJson<WireRevocationResponse>(response);
    return {
      serverMailboxId: body.serverMailboxId,
      status: body.status,
      revocationId: body.revocationId,
      revokedAt: new Date(body.revokedAt),
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    idempotency?: { idempotencyKey?: string; correlationId?: string },
  ): Promise<Response> {
    const baseUrl = this.config.mailboxMotorBaseUrl;
    if (!baseUrl) {
      // Should be unreachable in practice — env.validation.ts requires this when MAILBOX_MOTOR_DRIVER=http.
      throw new ServiceUnavailableException('MAILBOX_MOTOR_BASE_URL no está configurada.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.mailboxMotorTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.mailboxMotorApiKey}`,
          'X-Correlation-Id': idempotency?.correlationId ?? randomUUID(),
          ...(idempotency?.idempotencyKey ? { 'Idempotency-Key': idempotency.idempotencyKey } : {}),
        },
      });
    } catch {
      // Never log the raw error: it can embed the motor's host/port, and a
      // timeout/abort here is expected operational behavior, not a bug.
      this.logger.warn(`Mailbox motor request to ${path} failed or timed out.`);
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 400) {
      throw new BadRequestException('Token de vinculación inválido o no reconocido.');
    }
    if (response.status === 409) {
      throw new ConflictException('Esta cuenta o token ya fue procesado por otra organización.');
    }
    if (response.status === 410) {
      throw new GoneException('El token venció o fue revocado.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('El servidor motor no está disponible.');
    }

    return response;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('Respuesta inválida del servidor motor.');
    }
  }
}
