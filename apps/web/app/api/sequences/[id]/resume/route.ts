import { NextRequest, NextResponse } from 'next/server';
import type { SequenceSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const sequence = await apiFetch<SequenceSummary>(`/sequences/${params.id}/resume`, { method: 'POST' });
    return NextResponse.json(sequence);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
