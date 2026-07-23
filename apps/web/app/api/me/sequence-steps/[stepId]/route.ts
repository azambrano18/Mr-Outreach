import { NextRequest, NextResponse } from 'next/server';
import type { SequenceStepSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { stepId: string } },
): Promise<NextResponse> {
  try {
    const step = await apiFetch<SequenceStepSummary>(`/me/sequence-steps/${params.stepId}`);
    return NextResponse.json(step);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { stepId: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const step = await apiFetch<SequenceStepSummary>(`/me/sequence-steps/${params.stepId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(step);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
