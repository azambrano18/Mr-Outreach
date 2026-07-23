import { NextRequest, NextResponse } from 'next/server';
import type { SequenceSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const sequences = await apiFetch<SequenceSummary[]>('/me/sequences');
    return NextResponse.json(sequences);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
