-- Persists the admin's explicit authorization to remove a mailbox's
-- MailboxAssignment rows once its unlink is confirmed REVOKED by the motor.
-- Needed because UnlinkMailboxUseCase.retryConfirmation() re-confirms an
-- in-flight unlink with no request body of its own — the authorization
-- captured on the original POST /mailboxes/:id/unlink must survive that
-- retry. Defaults to false so every pre-existing row keeps today's
-- behavior (assignments untouched by unlink) until a new unlink request
-- explicitly opts in.

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN "unlinkRemoveAssignments" BOOLEAN NOT NULL DEFAULT false;
