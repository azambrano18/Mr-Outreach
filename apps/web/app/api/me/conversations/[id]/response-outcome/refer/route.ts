import { NextRequest, NextResponse } from 'next/server';
import type { ReferProspectResult } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const result = await apiFetch<ReferProspectResult>(
      `/me/conversations/${params.id}/response-outcome/refer`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
