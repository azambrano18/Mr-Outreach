import { NextRequest, NextResponse } from 'next/server';
import type { ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const client = await apiFetch<ManagedClientSummary>(`/me/clients/${params.id}`);
    return NextResponse.json(client);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
