import { NextRequest, NextResponse } from 'next/server';
import type { DeletionImpact } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const impact = await apiFetch<DeletionImpact>(`/users/${params.id}/deletion-impact`);
    return NextResponse.json(impact);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
