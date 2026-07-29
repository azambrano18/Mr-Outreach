-- Fase 2.1 — additive-only migration for token-based mailbox linking.
--
-- IMPORTANT: this file was hand-written, NOT taken verbatim from
-- `prisma migrate diff`. That raw diff also proposed DROP TABLE for
-- historial_crm/maestro_*/portal_*/prospectos_crm — those tables live in
-- the SAME physical Neon database but are the external, unmanaged CRM
-- schema (public.maestro_clientes et al.), never modeled by this Prisma
-- schema by design (see schema.prisma's own comment on ManagedClient).
-- Prisma's diff tool cannot tell "not modeled" apart from "should be
-- dropped" when comparing live DB state to the datamodel, so every one of
-- those statements was discarded. This migration touches ONLY "mailboxes"
-- and adds 3 new enums — nothing else in the database is touched, and
-- public.maestro_clientes is not referenced anywhere below.
--
-- Adds (all additive/nullable, no data loss):
-- 1) MailboxLinkSource / MailboxLinkStatus / MailboxServerTechnicalStatus
--    enums.
-- 2) linkSource (default LEGACY_LOCAL) + linkStatus (default LEGACY) on
--    every existing row — see backfill note below.
-- 3) 19 new nullable columns on "mailboxes" for server-token linking
--    (serverMailboxId, serverDomainId, serverClientId, serverRedemptionId,
--    tokenFingerprint, snapshots, link lifecycle timestamps/actors,
--    lastLinkCommandId).
-- 4) Relaxes NOT NULL on the 12 IMAP/SMTP columns — a SERVER_TOKEN mailbox
--    never populates them. No existing value is changed or dropped; every
--    LEGACY_LOCAL row keeps its current (still NOT NULL in practice)
--    values untouched.
-- 5) UNIQUE(serverMailboxId), UNIQUE(serverRedemptionId) — nullable
--    columns, so any number of existing (and future LEGACY_LOCAL) rows
--    with NULL coexist fine; only two non-null values would collide.
-- 6) Index on linkStatus for the admin list/filter.
--
-- Backfill: none needed. `linkSource DEFAULT 'LEGACY_LOCAL'` and
-- `linkStatus DEFAULT 'LEGACY'` apply to every pre-existing row
-- automatically as part of the ADD COLUMN — this is exactly the intended
-- classification ("cuentas existentes sin serverMailboxId quedan como
-- linkSource = LEGACY_LOCAL, linkStatus = LEGACY", §10 of the phase spec).
--
-- Pre-migration verification (mr-outreach-test, read-only, 2026-07-24):
-- 3 mailboxes total, 0 with any serverMailboxId-shaped data, 0 signatures,
-- 0 primary assignments, 0 non-archived sequences referencing them — see
-- Fase 2.1 Etapa 1 diagnosis for the full inventory (also covers
-- mr-outreach-dev, not touched by this migration).

-- CreateEnum
CREATE TYPE "MailboxLinkSource" AS ENUM ('LEGACY_LOCAL', 'SERVER_TOKEN');

-- CreateEnum
CREATE TYPE "MailboxLinkStatus" AS ENUM ('LINK_PENDING', 'ACTIVE', 'UNLINK_REQUESTED', 'REVOKED', 'LINK_ERROR', 'LEGACY');

-- CreateEnum
CREATE TYPE "MailboxServerTechnicalStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'DISABLED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "mailboxes"
  ALTER COLUMN "imapHost" DROP NOT NULL,
  ALTER COLUMN "imapPort" DROP NOT NULL,
  ALTER COLUMN "imapEncryption" DROP NOT NULL,
  ALTER COLUMN "imapUsername" DROP NOT NULL,
  ALTER COLUMN "imapVerifyCertificate" DROP NOT NULL,
  ALTER COLUMN "imapSecretCiphertext" DROP NOT NULL,
  ALTER COLUMN "smtpHost" DROP NOT NULL,
  ALTER COLUMN "smtpPort" DROP NOT NULL,
  ALTER COLUMN "smtpEncryption" DROP NOT NULL,
  ALTER COLUMN "smtpUsername" DROP NOT NULL,
  ALTER COLUMN "smtpVerifyCertificate" DROP NOT NULL,
  ALTER COLUMN "smtpSecretCiphertext" DROP NOT NULL,
  ADD COLUMN     "linkSource" "MailboxLinkSource" NOT NULL DEFAULT 'LEGACY_LOCAL',
  ADD COLUMN     "linkStatus" "MailboxLinkStatus" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN     "serverMailboxId" TEXT,
  ADD COLUMN     "serverDomainId" TEXT,
  ADD COLUMN     "serverClientId" TEXT,
  ADD COLUMN     "serverRedemptionId" TEXT,
  ADD COLUMN     "tokenFingerprint" TEXT,
  ADD COLUMN     "emailSnapshot" TEXT,
  ADD COLUMN     "domainSnapshot" TEXT,
  ADD COLUMN     "clientNameSnapshot" TEXT,
  ADD COLUMN     "serverStatusSnapshot" "MailboxServerTechnicalStatus",
  ADD COLUMN     "serverCanSendSnapshot" BOOLEAN,
  ADD COLUMN     "serverStatusCheckedAt" TIMESTAMP(3),
  ADD COLUMN     "linkedAt" TIMESTAMP(3),
  ADD COLUMN     "linkedBy" TEXT,
  ADD COLUMN     "unlinkRequestedAt" TIMESTAMP(3),
  ADD COLUMN     "unlinkRequestedBy" TEXT,
  ADD COLUMN     "unlinkReason" TEXT,
  ADD COLUMN     "revokedAt" TIMESTAMP(3),
  ADD COLUMN     "revocationId" TEXT,
  ADD COLUMN     "lastLinkCommandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_serverMailboxId_key" ON "mailboxes"("serverMailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_serverRedemptionId_key" ON "mailboxes"("serverRedemptionId");

-- CreateIndex
CREATE INDEX "mailboxes_linkStatus_idx" ON "mailboxes"("linkStatus");
