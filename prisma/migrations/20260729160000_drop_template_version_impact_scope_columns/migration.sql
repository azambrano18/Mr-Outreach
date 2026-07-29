-- Consolidación contractual previa a la integración con Railway.
--
-- Retires the "update in place" impact/scope bookkeeping on
-- sequence_template_versions: editing an already-published template now
-- always produces a brand-new, independently-serverTemplateId'd version via
-- the exact same publish command a first publish uses (see
-- UpdateSequenceTemplateUseCase / SequenceTemplateMotorPort). Since a new
-- version can never modify an existing Gestión's already-immutable version,
-- there is nothing left for these columns to ever report — audited across
-- the whole codebase (application services, use-cases, HTTP/simulated
-- adapters, both repositories, frontend types) and confirmed unused
-- anywhere else before being dropped here.
--
-- `serverTemplateId` already carries a UNIQUE constraint from its original
-- migration (20260725100000_sequence_templates_and_executions) — untouched
-- here, still the guarantee that every version's serverTemplateId is
-- distinct.

ALTER TABLE "sequence_template_versions"
  DROP COLUMN "effectiveScope",
  DROP COLUMN "affectedExecutions",
  DROP COLUMN "affectedPendingJobs",
  DROP COLUMN "unchangedSentJobs",
  DROP COLUMN "processingJobsNotChanged",
  DROP COLUMN "appliedAt";
