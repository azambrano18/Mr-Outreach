/**
 * Fase 1.5 (cierre operativo) — local development deliberately keeps
 * CRM_DRIVER=postgres in apps/api/.env so the running dev server shows the
 * real corporate catalog end-to-end. That same file must never silently
 * make an ordinary `npm test` / `npm run test:e2e` run reach the real,
 * external CRM database — those must always use MockCrmClientRepository.
 *
 * Mirrors test-database-guard.ts's shape: a single, centralized check
 * called right before the risky object (here, a real `pg.Pool` against the
 * external CRM) would otherwise be constructed. Never touches or logs the
 * connection string — it only inspects which driver was selected.
 *
 * Only NODE_ENV=test is guarded; a normal development or production boot
 * with CRM_DRIVER=postgres is untouched. A deliberate, separately-run CRM
 * integration check may set ALLOW_REAL_CRM_IN_TESTS=true to opt back in.
 */
export function assertCrmDriverAllowedInTests(crmDriver: string): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (crmDriver !== 'postgres') return;
  if (process.env.ALLOW_REAL_CRM_IN_TESTS === 'true') return;

  throw new Error(
    'Las pruebas ordinarias no pueden utilizar el CRM real. Usa CRM_DRIVER=mock o habilita explícitamente una prueba de integración CRM autorizada.',
  );
}
