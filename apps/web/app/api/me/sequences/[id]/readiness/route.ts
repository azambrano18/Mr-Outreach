import { NextRequest, NextResponse } from 'next/server';
import type { SequenceReadiness } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const readiness = await apiFetch<SequenceReadiness>(`/me/sequences/${params.id}/readiness`);
    return NextResponse.json(readiness);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
