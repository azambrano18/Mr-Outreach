-- Fase Firma — signature moves from the mailbox (Signature/SignatureVersion,
-- kept intact and unlinked from the UI) into each SequenceTemplate as its
-- own editable draft field.
ALTER TABLE "sequence_templates"
  ADD COLUMN "signatureHtml" TEXT NOT NULL DEFAULT '';

-- One-time backfill: any template created before this column existed was
-- rendering its signature dynamically from the mailbox's current active
-- Signature version at publish time. Snapshot that same content into the
-- new draft field now, so no in-flight draft silently loses its signature.
UPDATE "sequence_templates" t
SET "signatureHtml" = COALESCE(sv."htmlContent", '')
FROM "signatures" s
JOIN "signature_versions" sv ON sv.id = s."activeVersionId"
WHERE s."mailboxId" = t."mailboxId" AND s."activeVersionId" IS NOT NULL;
