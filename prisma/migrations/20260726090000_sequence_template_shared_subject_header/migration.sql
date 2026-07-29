-- Etapa "cuenta del ejecutivo" (corrección de experiencia) — §4/§5: el
-- asunto y el header dejan de ser propiedad de cada envío y pasan a vivir
-- una sola vez en la plantilla (y en cada versión publicada, congelados).
-- Additive only: las columnas "subjectTemplate"/"headerHtml" en
-- sequence_template_steps quedan vestigiales (nunca más leídas/escritas por
-- la aplicación) en vez de borrarse, evitando una migración destructiva
-- innecesaria.

-- AlterTable
ALTER TABLE "sequence_templates"
  ADD COLUMN "subjectTemplate" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "headerText" TEXT;

-- AlterTable
ALTER TABLE "sequence_template_versions"
  ADD COLUMN "subjectTemplate" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "headerText" TEXT;
