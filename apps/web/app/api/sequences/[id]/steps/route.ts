import { NextRequest, NextResponse } from 'next/server';
import type { SequenceStepSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const steps = await apiFetch<SequenceStepSummary[]>(`/sequences/${params.id}/steps`);
    return NextResponse.json(steps);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
