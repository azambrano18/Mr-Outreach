import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionContext } from '../../domain/persistence/transaction';
import { UserRepository } from '../../domain/user/user.repository';
import { USER_REPOSITORY } from '../../infrastructure/persistence/tokens';

export interface MailboxExecutiveAssignmentInput {
  organizationId: string;
  clientId: string;
  primaryExecutiveId?: string | null;
  secondaryExecutiveIds?: string[];
}

export interface MailboxExecutiveAssignmentPlan {
  primaryExecutiveId: string | null;
  secondaryExecutiveIds: string[];
}

/**
 * Single, shared authority for "may this executive be assigned to a
 * mailbox of this client", used by `LinkMailboxUseCase` and
 * `UpdateMailboxConfigurationUseCase` (never duplicated). Deliberately pure
 * validation: never writes an assignment itself — that stays the caller's
 * responsibility (MailboxAssignmentRepository), exactly like
 * SequenceEligibilityService's own "validates, never writes" contract from
 * Caso C.
 *
 * Called twice by design, per the approved proposal:
 *  - once with `ctx` omitted, before opening the transaction, purely to
 *    fail fast on the common cases (never authoritative on its own);
 *  - once with the transaction's own `ctx`, right before the assignment
 *    writes happen — this is the call that actually gates the write,
 *    closing the race window where an executive could be deactivated or
 *    unassigned from the client between the preliminary check and the
 *    commit.
 */
@Injectable()
export class MailboxExecutiveAssignmentValidator {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  /**
   * Normalizes primary/secondary into a deduped shape — pure, no I/O.
   * Rejects (never silently drops) a primary duplicated in the secondary
   * list: an admin submitting the same user as both is an input mistake
   * that must surface, not be masked.
   */
  plan(primaryExecutiveId?: string | null, secondaryExecutiveIds?: string[]): MailboxExecutiveAssignmentPlan {
    const primary = primaryExecutiveId ?? null;
    const secondary = [...new Set(secondaryExecutiveIds ?? [])];
    if (primary && secondary.includes(primary)) {
      throw new BadRequestException('El ejecutivo principal no puede aparecer también como secundario.');
    }
    return { primaryExecutiveId: primary, secondaryExecutiveIds: secondary };
  }

  /**
   * §10 — being assigned to a mailbox never requires prior client
   * visibility; the opposite is now true (mailbox assignment automatically
   * *grants* client visibility, see ClientMailboxVisibilityService). This
   * only validates that the executive exists, is active, and belongs to
   * this organization.
   */
  async validate(input: MailboxExecutiveAssignmentInput, ctx?: TransactionContext): Promise<void> {
    const { primaryExecutiveId, secondaryExecutiveIds } = this.plan(
      input.primaryExecutiveId,
      input.secondaryExecutiveIds,
    );
    const executiveIds = [...new Set([primaryExecutiveId, ...secondaryExecutiveIds].filter((id): id is string => !!id))];

    for (const executiveId of executiveIds) {
      const user = await this.users.findById(executiveId, ctx);
      // Never reveal whether a user exists in a different organization — 404 either way.
      if (!user || user.organizationId !== input.organizationId) {
        throw new NotFoundException('Ejecutivo no encontrado.');
      }
      if (user.status !== 'ACTIVE') {
        throw new ConflictException('El ejecutivo seleccionado no está activo.');
      }
    }
  }
}
