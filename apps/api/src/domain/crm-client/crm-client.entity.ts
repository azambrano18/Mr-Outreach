/**
 * Mirrors the REAL columns of Neon's external `maestro_clientes` table
 * (confirmed via a one-off introspection — see apps/api/scripts/introspect-crm-schema.ts —
 * against the actual database, not assumed). `crmClientId` is a plain
 * integer there (not a UUID like every id elsewhere in this app), and
 * `status` is kept as the raw stored string (`"ACTIVO"`/`"INACTIVO"`, with
 * at least one row observed with a stray trailing space) — comparisons
 * must trim + case-fold, never compare it as an exact string.
 */
export interface CrmClient {
  crmClientId: number;
  name: string; // maestro_clientes.empresa
  rut: string | null;
  rubro: string | null;
  status: string; // maestro_clientes.status, raw/untrimmed as stored
}
