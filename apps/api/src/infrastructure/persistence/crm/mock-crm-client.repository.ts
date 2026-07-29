import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CrmClient } from '../../../domain/crm-client/crm-client.entity';
import { CrmClientFilter, CrmClientRepository } from '../../../domain/crm-client/crm-client.repository';

/**
 * Fase 1.5 — reserved sentinel id for e2e tests that need to exercise a
 * CRM outage deterministically without a live Postgres/network failure to
 * trigger it (mirrors the "+etiqueta" convention SimulatedMailEngineAdapter
 * already uses for deterministic scenario testing). Never a real
 * maestro_clientes id — 1001-1005/2001+ are all real demo entries below.
 */
export const MOCK_CRM_OUTAGE_SENTINEL_ID = 999999;

/**
 * Demo dataset for local/CI use when CRM_DRIVER=mock (the default) — shaped
 * exactly like the real `maestro_clientes` columns confirmed via
 * introspection (id/empresa/rut/rubro/status), including one row with the
 * same trailing-space status quirk observed in the real data, so that quirk
 * gets exercised even without a live Neon connection.
 */
const DEMO_CLIENTS: CrmClient[] = [
  { crmClientId: 1001, name: 'Empresa Demostración', rut: '76.123.456-7', rubro: 'Servicios', status: 'ACTIVO' },
  { crmClientId: 1002, name: 'Demo Servicios Norte', rut: '76.234.567-8', rubro: 'Servicios', status: 'ACTIVO' },
  { crmClientId: 1003, name: 'Demo Tecnología Sur', rut: '76.345.678-9', rubro: 'Servicios', status: 'ACTIVO' },
  { crmClientId: 1004, name: 'Demo Retail Centro', rut: '76.456.789-0', rubro: 'Servicios', status: 'INACTIVO' },
  { crmClientId: 1005, name: 'Demo Alimentos Costa', rut: '76.567.890-1', rubro: 'Servicios', status: 'INACTIVO ' },
  // A generous block of generic active entries — e2e/admin-UI tests each
  // "configure" their own throwaway ManagedClient and need a distinct,
  // real (mock) crmClientId to do so; 5 named entries above aren't enough
  // headroom for a whole test suite's worth of independent client fixtures.
  ...Array.from({ length: 50 }, (_, index) => ({
    crmClientId: 2001 + index,
    name: `Cliente Demo ${index + 1}`,
    rut: `77.${String(100 + index).padStart(3, '0')}.000-${index % 10}`,
    rubro: 'Servicios',
    status: 'ACTIVO',
  })),
];

@Injectable()
export class MockCrmClientRepository implements CrmClientRepository {
  /**
   * Fase 1.5 — test-only escape hatch, same in-process-hook pattern as
   * SimulatedMailEngineAdapter.setImportScenario(): e2e specs that need a
   * client to flip from active to inactive *after* it was already
   * configured (to prove new activity gets blocked while old activity
   * stays readable) can't do that with the static DEMO_CLIENTS list alone.
   * Never reachable from any HTTP route.
   */
  private readonly statusOverrides = new Map<number, string>();

  setStatusOverride(crmClientId: number, status: string): void {
    this.statusOverrides.set(crmClientId, status);
  }

  clearStatusOverride(crmClientId: number): void {
    this.statusOverrides.delete(crmClientId);
  }

  async findAllActive(filter: CrmClientFilter = {}): Promise<CrmClient[]> {
    const search = filter.search?.trim().toLowerCase();
    return DEMO_CLIENTS.map((client) => this.applyOverride(client)).filter((client) => {
      const isActive = client.status.trim().toUpperCase() === 'ACTIVO';
      const matchesSearch = !search || client.name.toLowerCase().includes(search);
      return isActive && matchesSearch;
    });
  }

  async findById(crmClientId: number): Promise<CrmClient | null> {
    if (crmClientId === MOCK_CRM_OUTAGE_SENTINEL_ID) {
      throw new ServiceUnavailableException('CRM temporarily unavailable.');
    }
    const client = DEMO_CLIENTS.find((c) => c.crmClientId === crmClientId) ?? null;
    return client ? this.applyOverride(client) : null;
  }

  private applyOverride(client: CrmClient): CrmClient {
    const override = this.statusOverrides.get(client.crmClientId);
    return override === undefined ? client : { ...client, status: override };
  }
}
