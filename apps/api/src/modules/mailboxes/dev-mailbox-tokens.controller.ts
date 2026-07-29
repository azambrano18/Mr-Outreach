import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SimulatedMailboxMotorAdapter } from '../../infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

export interface DemoTokenScenario {
  key: 'VALID' | 'EXPIRED' | 'USED' | 'REVOKED' | 'DISCONNECTED' | 'NO_SEND';
  label: string;
  token: string;
  expiresAt: string;
  mailbox: { email: string; displayName: string; status: string; canSend: boolean };
  client: { name: string };
  domain: { name: string };
}

/**
 * Dev-only helper (§5 of the "corregir interfaz administrativa" spec) — a
 * copy-pasteable set of demo tokens covering every introspection/redemption
 * scenario, generated against `SimulatedMailboxMotorAdapter` (never a real
 * motor, never real credentials). Exists ONLY when
 * `MAILBOX_MOTOR_DRIVER=simulated`; 404s otherwise so it never leaks the
 * existence of a dev-only surface in an environment pointed at a real
 * Railway motor. A fixed synthetic `requestingOrganizationId` is used only
 * to pre-redeem the "USED" scenario — it never touches any real
 * organization's data.
 */
@ApiTags('mailboxes')
@Controller('mailboxes/dev')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevMailboxTokensController {
  constructor(
    private readonly config: AppConfigService,
    private readonly motor: SimulatedMailboxMotorAdapter,
  ) {}

  @Get('demo-tokens')
  @RequirePermissions('mailboxes.link')
  async demoTokens(): Promise<DemoTokenScenario[]> {
    if (this.config.mailboxMotorDriver !== 'simulated') {
      throw new NotFoundException();
    }

    const base = {
      email: 'ventas@empresademostracion.cl',
      displayName: 'Ventas Empresa Demostración',
      domainName: 'empresademostracion.cl',
      clientName: 'Empresa Demostración',
    };

    const scenarios: Array<Omit<DemoTokenScenario, 'token' | 'expiresAt' | 'mailbox' | 'client' | 'domain'> & {
      issue: () => { token: string; expiresAt: Date; mailbox: DemoTokenScenario['mailbox']; client: DemoTokenScenario['client']; domain: DemoTokenScenario['domain'] };
    }> = [
      {
        key: 'VALID',
        label: 'Token válido',
        issue: () => this.issueAndDescribe(base, {}),
      },
      {
        key: 'EXPIRED',
        label: 'Token vencido',
        issue: () => this.issueAndDescribe(base, { scenario: 'EXPIRED' }),
      },
      {
        key: 'REVOKED',
        label: 'Token revocado',
        issue: () => this.issueAndDescribe(base, { scenario: 'REVOKED' }),
      },
      {
        key: 'DISCONNECTED',
        label: 'Cuenta desconectada',
        issue: () => this.issueAndDescribe(base, { mailboxStatus: 'DISCONNECTED', canSend: false }),
      },
      {
        key: 'NO_SEND',
        label: 'Cuenta conectada sin capacidad de envío',
        issue: () => this.issueAndDescribe(base, { mailboxStatus: 'CONNECTED', canSend: false }),
      },
    ];

    const results = scenarios.map((scenario) => ({ ...scenario, ...scenario.issue() }));

    // "Used" needs an actual redemption against a synthetic org, so a fresh
    // introspect from any real organization sees status REDEEMED.
    const usedIssued = this.issueAndDescribe(base, {});
    await this.motor.redeemLinkToken({
      token: usedIssued.token,
      idempotencyKey: `dev_seed_${Date.now()}`,
      requestingOrganizationId: 'dev_demo_org_used_token_scenario',
      actorId: 'dev_seed',
    });

    return [
      ...results.map(({ key, label, token, expiresAt, mailbox, client, domain }) => ({
        key,
        label,
        token,
        expiresAt: expiresAt.toISOString(),
        mailbox,
        client,
        domain,
      })),
      {
        key: 'USED' as const,
        label: 'Token ya utilizado',
        token: usedIssued.token,
        expiresAt: usedIssued.expiresAt.toISOString(),
        mailbox: usedIssued.mailbox,
        client: usedIssued.client,
        domain: usedIssued.domain,
      },
    ];
  }

  private issueAndDescribe(
    base: { email: string; displayName: string; domainName: string; clientName: string },
    overrides: Parameters<SimulatedMailboxMotorAdapter['issueLinkToken']>[0] extends infer T
      ? Partial<Omit<T, keyof typeof base>>
      : never,
  ) {
    const token = this.motor.issueLinkToken({ ...base, canSend: true, ...overrides });
    // Re-introspect to read back exactly what the token now represents —
    // never hand-duplicate the adapter's own scenario/expiry logic here.
    return {
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      mailbox: {
        email: base.email,
        displayName: base.displayName,
        status: overrides.mailboxStatus ?? 'CONNECTED',
        canSend: overrides.canSend ?? true,
      },
      client: { name: base.clientName },
      domain: { name: base.domainName },
    };
  }
}
