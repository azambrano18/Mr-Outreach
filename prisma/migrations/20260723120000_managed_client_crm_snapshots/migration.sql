-- Fase 1.5 — additive-only migration. Adds CRM snapshot columns to
-- managed_clients (name/industry already existed and now serve as the
-- name/industry snapshot themselves — no rename). Does not touch any
-- other table, does not touch public.maestro_clientes (not modeled by
-- Prisma at all), does not drop or rename any column.
ALTER TABLE "managed_clients" ADD COLUMN     "crmRutSnapshot" TEXT,
ADD COLUMN     "crmStatusCheckedAt" TIMESTAMP(3),
ADD COLUMN     "crmStatusSnapshot" TEXT;
