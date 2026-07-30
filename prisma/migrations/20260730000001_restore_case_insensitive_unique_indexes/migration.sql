-- Restores 2 hand-written partial/expression unique indexes that existed
-- only as raw SQL in the pre-consolidation migration history (Prisma has
-- no declarative syntax for a partial index or an expression like
-- LOWER(email) inside @@unique) — lost when the 13 incremental migrations
-- were replaced by 20260730000000_init_mr_outreach, which was generated
-- purely from schema.prisma's declarative model attributes via
-- `prisma migrate diff --from-empty --to-schema-datamodel` and therefore
-- had no way to know about them. See the explanatory comments already on
-- the Company/Contact models in schema.prisma.

CREATE UNIQUE INDEX "companies_org_client_normalized_active_key" ON "companies"("organizationId", "clientId", "normalizedName") WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "contacts_org_client_email_ci_active_key" ON "contacts"("organizationId", "clientId", LOWER("email")) WHERE "deletedAt" IS NULL;
