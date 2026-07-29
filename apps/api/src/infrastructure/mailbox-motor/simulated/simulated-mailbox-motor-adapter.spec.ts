import { BadRequestException, ConflictException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { fingerprintToken, SimulatedMailboxMotorAdapter } from './simulated-mailbox-motor-adapter';

describe('SimulatedMailboxMotorAdapter', () => {
  let adapter: SimulatedMailboxMotorAdapter;

  beforeEach(() => {
    adapter = new SimulatedMailboxMotorAdapter();
  });

  function issue(overrides: Partial<Parameters<SimulatedMailboxMotorAdapter['issueLinkToken']>[0]> = {}) {
    return adapter.issueLinkToken({
      email: 'ventas@cliente.cl',
      displayName: 'Ventas',
      domainName: 'cliente.cl',
      clientName: 'Cliente Ejemplo',
      crmClientId: 88,
      ...overrides,
    });
  }

  describe('introspectLinkToken', () => {
    it('reports a freshly-issued token as valid, with a 24h expiry by default', async () => {
      const token = issue();
      const info = await adapter.introspectLinkToken(token);
      expect(info.valid).toBe(true);
      expect(info.status).toBe('ISSUED');
      expect(info.mailbox.email).toBe('ventas@cliente.cl');
      expect(info.domain.name).toBe('cliente.cl');
      expect(info.client.crmClientId).toBe(88);
      const hoursUntilExpiry = (info.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
      expect(hoursUntilExpiry).toBeGreaterThan(23.9);
      expect(hoursUntilExpiry).toBeLessThanOrEqual(24);
    });

    it('rejects an unrecognized token as a 400, never revealing whether it once existed', async () => {
      await expect(adapter.introspectLinkToken('mmt_does-not-exist')).rejects.toThrow(BadRequestException);
    });

    it('reports an expired token as invalid without throwing', async () => {
      const token = issue({ scenario: 'EXPIRED', email: 'x@y.cl', displayName: 'X', domainName: 'y.cl', clientName: 'Y' });
      const info = await adapter.introspectLinkToken(token);
      expect(info.valid).toBe(false);
      expect(info.status).toBe('EXPIRED');
    });

    it('reports a revoked token as invalid without throwing', async () => {
      const token = issue({ scenario: 'REVOKED', email: 'x@y.cl', displayName: 'X', domainName: 'y.cl', clientName: 'Y' });
      const info = await adapter.introspectLinkToken(token);
      expect(info.valid).toBe(false);
      expect(info.status).toBe('REVOKED');
    });

    it('reports an already-redeemed token as REDEEMED', async () => {
      const token = issue();
      await adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' });
      const info = await adapter.introspectLinkToken(token);
      expect(info.valid).toBe(false);
      expect(info.status).toBe('REDEEMED');
    });

    it('never registers a redemption or a duplicate mailbox as a side effect of introspecting', async () => {
      const token = issue();
      await adapter.introspectLinkToken(token);
      await adapter.introspectLinkToken(token);
      const info = await adapter.introspectLinkToken(token);
      expect(info.status).toBe('ISSUED'); // still un-redeemed
    });
  });

  describe('redeemLinkToken', () => {
    it('redeems a valid token successfully', async () => {
      const token = issue();
      const redemption = await adapter.redeemLinkToken({
        token,
        idempotencyKey: 'k1',
        requestingOrganizationId: 'org_1',
        actorId: 'admin_1',
      });
      expect(redemption.status).toBe('REDEEMED');
      expect(redemption.mailbox.email).toBe('ventas@cliente.cl');
      expect(redemption.redemptionId).toMatch(/^red_/);
    });

    it('rejects a malformed/unknown token as 400', async () => {
      await expect(
        adapter.redeemLinkToken({ token: 'nope', idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token as 410 Gone', async () => {
      const token = issue({ scenario: 'EXPIRED', email: 'x@y.cl', displayName: 'X', domainName: 'y.cl', clientName: 'Y' });
      await expect(
        adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' }),
      ).rejects.toThrow(GoneException);
    });

    it('rejects a revoked token as 410 Gone', async () => {
      const token = issue({ scenario: 'REVOKED', email: 'x@y.cl', displayName: 'X', domainName: 'y.cl', clientName: 'Y' });
      await expect(
        adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' }),
      ).rejects.toThrow(GoneException);
    });

    it('replays the identical receipt when the SAME organization redeems the same token again', async () => {
      const token = issue();
      const first = await adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' });
      const second = await adapter.redeemLinkToken({ token, idempotencyKey: 'k2', requestingOrganizationId: 'org_1', actorId: 'admin_2' });
      expect(second).toEqual(first);
    });

    it('rejects redemption by a DIFFERENT organization than the one that already redeemed it, as 409', async () => {
      const token = issue();
      await adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' });
      await expect(
        adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_2', actorId: 'admin_1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('never leaks the token value inside the redemption receipt', async () => {
      const token = issue();
      const redemption = await adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' });
      expect(JSON.stringify(redemption)).not.toContain(token);
    });
  });

  describe('getMailboxStatus', () => {
    it('reflects CONNECTED/canSend by default after issuance', async () => {
      const token = issue();
      const { mailbox } = await adapter.introspectLinkToken(token);
      const status = await adapter.getMailboxStatus(mailbox.serverMailboxId);
      expect(status.technicalStatus).toBe('CONNECTED');
      expect(status.canSend).toBe(true);
      expect(status.linkStatus).toBe('ACTIVE');
    });

    it('reflects a DISCONNECTED/DISABLED technical status set for testing', async () => {
      const token = issue();
      const { mailbox } = await adapter.introspectLinkToken(token);
      adapter.setMailboxTechnicalStatus(mailbox.serverMailboxId, 'DISCONNECTED', false);
      const status = await adapter.getMailboxStatus(mailbox.serverMailboxId);
      expect(status.technicalStatus).toBe('DISCONNECTED');
      expect(status.canSend).toBe(false);
    });

    it('rejects an unknown serverMailboxId', async () => {
      await expect(adapter.getMailboxStatus('mbx_unknown')).rejects.toThrow(BadRequestException);
    });
  });

  describe('unlinkMailbox', () => {
    it('revokes successfully and is reflected by a subsequent status query', async () => {
      const token = issue();
      const { mailbox } = await adapter.introspectLinkToken(token);
      const revocation = await adapter.unlinkMailbox({
        serverMailboxId: mailbox.serverMailboxId,
        idempotencyKey: 'u1',
        requestingOrganizationId: 'org_1',
        actorId: 'admin_1',
        reason: 'Cuenta dada de baja',
        correlationId: 'corr_1',
      });
      expect(revocation.status).toBe('REVOKED');
      const status = await adapter.getMailboxStatus(mailbox.serverMailboxId);
      expect(status.linkStatus).toBe('REVOKED');
    });

    it('fails without changing link status when the simulated outcome is FAILURE', async () => {
      const token = issue();
      const { mailbox } = await adapter.introspectLinkToken(token);
      adapter.setUnlinkOutcome(mailbox.serverMailboxId, 'FAILURE');
      await expect(
        adapter.unlinkMailbox({
          serverMailboxId: mailbox.serverMailboxId,
          idempotencyKey: 'u1',
          requestingOrganizationId: 'org_1',
          actorId: 'admin_1',
          reason: 'x',
          correlationId: 'corr_1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      const status = await adapter.getMailboxStatus(mailbox.serverMailboxId);
      expect(status.linkStatus).toBe('ACTIVE');
    });
  });

  describe('motor unavailable (fail-closed)', () => {
    it('makes every method throw ServiceUnavailableException while the outage flag is set', async () => {
      const token = issue();
      const { mailbox } = await adapter.introspectLinkToken(token);
      adapter.setMotorUnavailable(true);

      await expect(adapter.introspectLinkToken(token)).rejects.toThrow(ServiceUnavailableException);
      await expect(
        adapter.redeemLinkToken({ token, idempotencyKey: 'k1', requestingOrganizationId: 'org_1', actorId: 'admin_1' }),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(adapter.getMailboxStatus(mailbox.serverMailboxId)).rejects.toThrow(ServiceUnavailableException);
      await expect(
        adapter.unlinkMailbox({
          serverMailboxId: mailbox.serverMailboxId,
          idempotencyKey: 'u1',
          requestingOrganizationId: 'org_1',
          actorId: 'admin_1',
          reason: 'x',
          correlationId: 'corr_1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('fingerprintToken', () => {
    it('never includes the full token, only its last 4 characters', () => {
      const token = 'mmt_abcdef1234a82f';
      const fp = fingerprintToken(token);
      expect(fp).toBe('tok_****a82f');
      expect(fp).not.toContain(token);
    });
  });
});
