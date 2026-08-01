-- CreateEnum
CREATE TYPE "MailboxAssetCleanupStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EmailBodyAssetStatus" AS ENUM ('AVAILABLE', 'REFERENCED', 'ORPHANED', 'DELETED');

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "assetCleanupAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "assetCleanupStatus" "MailboxAssetCleanupStatus" NOT NULL DEFAULT 'NOT_NEEDED',
ADD COLUMN     "lastAssetCleanupError" TEXT;

-- AlterTable
ALTER TABLE "signature_assets" ADD COLUMN     "mailboxId" TEXT;

-- CreateTable
CREATE TABLE "email_body_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "EmailBodyAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "email_body_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_body_assets_objectKey_key" ON "email_body_assets"("objectKey");

-- CreateIndex
CREATE INDEX "email_body_assets_organizationId_idx" ON "email_body_assets"("organizationId");

-- CreateIndex
CREATE INDEX "email_body_assets_status_idx" ON "email_body_assets"("status");

-- CreateIndex
CREATE INDEX "signature_assets_mailboxId_idx" ON "signature_assets"("mailboxId");

-- AddForeignKey
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_body_assets" ADD CONSTRAINT "email_body_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_body_assets" ADD CONSTRAINT "email_body_assets_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

