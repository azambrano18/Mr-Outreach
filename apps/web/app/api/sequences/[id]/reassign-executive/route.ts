import { NextRequest, NextResponse } from 'next/server';
import type { SequenceSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const sequence = await apiFetch<SequenceSummary>(`/sequences/${params.id}/reassign-executive`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(sequence);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
