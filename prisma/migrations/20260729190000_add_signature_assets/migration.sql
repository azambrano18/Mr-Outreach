-- Fase Firma — tracks every uploaded signature image (ownership, immutable
-- object key, dimensions/size/hash, referenced/orphan lifecycle). Never
-- stores the binary itself — that lives in the storage adapter (local disk
-- in `simulated` mode, Cloudflare R2 in `r2` mode).
CREATE TYPE "SignatureAssetStatus" AS ENUM ('AVAILABLE', 'REFERENCED', 'ORPHANED', 'DELETED');

CREATE TABLE "signature_assets" (
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
  "status" "SignatureAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "signature_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signature_assets_objectKey_key" ON "signature_assets"("objectKey");
CREATE INDEX "signature_assets_organizationId_idx" ON "signature_assets"("organizationId");
CREATE INDEX "signature_assets_status_idx" ON "signature_assets"("status");

ALTER TABLE "signature_assets"
  ADD CONSTRAINT "signature_assets_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "signature_assets"
  ADD CONSTRAINT "signature_assets_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
