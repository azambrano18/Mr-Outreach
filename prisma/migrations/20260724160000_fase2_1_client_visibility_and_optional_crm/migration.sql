-- Fase 2.1 (§9.1, §10) — additive-only migration, hand-written like
-- 20260724145103_fase2_1_mailbox_link_token (see that file's own comment
-- for why: this repo's external, unmanaged CRM schema in the same
-- physical Neon database confuses `prisma migrate diff`).
--
-- 1) ManagedClient.crmClientId becomes nullable — a client whose source is
--    SERVER (created from a Railway mailbox-link redemption with no CRM
--    linkage reported) never gets one fabricated. Every existing row keeps
--    its current (still non-null in practice) value untouched; the
--    existing UNIQUE(organizationId, crmClientId) index is unaffected —
--    Postgres never treats two NULLs as equal, so any number of SERVER
--    rows with a NULL crmClientId can coexist per organization.
-- 2) ManagedClient.source (default LEGACY_CRM) classifies every
--    pre-existing row as LEGACY_CRM automatically via the ADD COLUMN
--    default — exactly the intended backfill, no separate UPDATE needed.
-- 3) ManagedClient.serverClientId — the external Railway client id and new
--    dedupe/upsert key for SERVER-origin clients, nullable + unique.
-- 4) ClientExecutiveAssignment.visibilitySource (default MANUAL)
--    classifies every pre-existing assignment as an explicit admin grant
--    — correct, since MAILBOX_DERIVED visibility did not exist before this
--    migration.

-- CreateEnum
CREATE TYPE "ManagedClientSource" AS ENUM ('SERVER', 'LEGACY_CRM', 'MANUAL');

-- CreateEnum
CREATE TYPE "ClientVisibilitySource" AS ENUM ('MANUAL', 'MAILBOX_DERIVED');

-- AlterTable
ALTER TABLE "managed_clients"
  ALTER COLUMN "crmClientId" DROP NOT NULL,
  ADD COLUMN     "source" "ManagedClientSource" NOT NULL DEFAULT 'LEGACY_CRM',
  ADD COLUMN     "serverClientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "managed_clients_serverClientId_key" ON "managed_clients"("serverClientId");

-- AlterTable
ALTER TABLE "client_executive_assignments"
  ADD COLUMN     "visibilitySource" "ClientVisibilitySource" NOT NULL DEFAULT 'MANUAL';
