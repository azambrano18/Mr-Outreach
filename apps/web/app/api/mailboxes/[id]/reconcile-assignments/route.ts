import { NextRequest, NextResponse } from 'next/server';
import type { RemoveMailboxAssignmentsAfterUnlinkResult } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** §9 — "Limpiar asignaciones residuales" for a mailbox already REVOKED. Thin passthrough. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch<RemoveMailboxAssignmentsAfterUnlinkResult>(`/mailboxes/${params.id}/reconcile-assignments`, {
      method: 'POST',
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
