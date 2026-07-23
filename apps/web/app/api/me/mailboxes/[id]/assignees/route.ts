import { NextRequest, NextResponse } from 'next/server';
import type { AssigneeSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const assignees = await apiFetch<AssigneeSummary[]>(`/me/mailboxes/${params.id}/assignees`);
    return NextResponse.json(assignees);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
