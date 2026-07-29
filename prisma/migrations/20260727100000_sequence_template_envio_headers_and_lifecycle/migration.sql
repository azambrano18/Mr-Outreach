-- Etapa "cuenta del ejecutivo" (ajustes de Plantillas/Gestiones) — additive
-- only. §4: header vuelve a ser individual y opcional por envío
-- (sequence_template_steps.headerText nueva columna; sequence_templates.
-- headerText y sequence_template_steps.headerHtml quedan vestigiales).
-- §11: eliminación lógica de plantillas archivadas (deletedAt). §12-17:
-- columnas de seguimiento para "editar plantilla publicada" (solo se
-- completan cuando una versión proviene de una actualización, nunca en la
-- primera publicación).

-- AlterTable
ALTER TABLE "sequence_templates" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sequence_template_steps" ADD COLUMN "headerText" TEXT;

-- AlterTable
ALTER TABLE "sequence_template_versions"
  ADD COLUMN "previousVersionNumber" INTEGER,
  ADD COLUMN "effectiveScope" TEXT,
  ADD COLUMN "affectedExecutions" INTEGER,
  ADD COLUMN "affectedPendingJobs" INTEGER,
  ADD COLUMN "unchangedSentJobs" INTEGER,
  ADD COLUMN "processingJobsNotChanged" INTEGER,
  ADD COLUMN "appliedAt" TIMESTAMP(3);
