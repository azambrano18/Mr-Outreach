import { NextRequest, NextResponse } from 'next/server';
import type { AdminSequenceDetail } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const detail = await apiFetch<AdminSequenceDetail>(`/sequences/${params.id}/monitor`);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
