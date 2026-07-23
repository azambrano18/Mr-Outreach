import { ConflictException, Injectable } from '@nestjs/common';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { CrmClientsService } from './crm-clients.service';

/**
 * Fase 1.5 — the single, centralized place that decides whether a CRM
 * client is eligible for new activity. Used identically by admin and
 * executive flows (client activation, domains, mailboxes, assignments,
 * sequences) — never duplicated per flow.
 *
 * Deliberately has NO side effects: no ManagedClient writes, no snapshot
 * updates, no audit, no transaction. It only asks the CRM and answers.
 * `CrmClientsService.getById()` (which this calls) already throws the
 * correctly-typed exception for the two infrastructure-level cases —
 * `NotFoundException` when the CRM genuinely has no such client, and
 * `ServiceUnavailableException` when the CRM couldn't be reached at all
 * (see PostgresCrmClientRepository) — so this service never needs its own
 * try/catch to tell those apart, and never blanket-converts an unrelated
 * error into "unavailable".
 */
@Injectable()
export class CrmClientEligibilityService {
  constructor(
    private readonly crmClients: CrmClientsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Returns the verified, currently-active CRM client, or throws:
   * - `NotFoundException` (404) — no such client in the CRM at all.
   * - `ConflictException` (409) — the client exists but its CRM status
   *   isn't the configured "active" value.
   * - `ServiceUnavailableException` (503) — the CRM couldn't be reached;
   *   propagated as-is from CrmClientsService/CrmClientRepository.
   */
  async getVerifiedActiveClient(crmClientId: number): Promise<CrmClient> {
    const { crmClient, active } = await this.verify(crmClientId);
    if (!active) {
      throw new ConflictException('Este cliente está inactivo en el CRM y no admite nuevas configuraciones.');
    }
    return crmClient;
  }

  /**
   * Same lookup as `getVerifiedActiveClient`, but never throws on
   * "inactive" — returns the flag instead. Used only by ClientsService,
   * which (unlike every other caller) legitimately needs the raw CRM
   * client even when inactive, to refresh ManagedClient's CRM snapshot
   * before blocking the operation (§11 — the snapshot must reflect
   * reality even when the answer is "inactive").
   */
  async verify(crmClientId: number): Promise<{ crmClient: CrmClient; active: boolean }> {
    const crmClient = await this.crmClients.getById(crmClientId);
    return { crmClient, active: this.isActive(crmClient) };
  }

  /** Same TRIM+UPPER normalization already used by the Postgres CRM adapter's own SQL comparison — never an exact-string match. */
  isActive(crmClient: CrmClient): boolean {
    return crmClient.status.trim().toUpperCase() === this.config.crmActiveStatusValue.trim().toUpperCase();
  }
}
