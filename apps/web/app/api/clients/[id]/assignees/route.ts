import { NextRequest, NextResponse } from 'next/server';
import type { ClientAssigneeSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

/**
 * Read-only — used by the sequence wizard's client/executive pickers.
 * Manual client-executive assignment is no longer an admin UI action
 * (visibility is derived from mailbox assignment, §10); the underlying
 * PUT /clients/:id/assignees endpoint stays on the backend for
 * ClientExecutiveAssignment's own mechanics, just unreached from here.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const assignees = await apiFetch<ClientAssigneeSummary[]>(`/clients/${params.id}/assignees`);
    return NextResponse.json(assignees);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
