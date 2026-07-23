import { NextRequest, NextResponse } from 'next/server';
import type { DomainSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const domain = await apiFetch<DomainSummary>(`/me/domains/${params.id}`);
    return NextResponse.json(domain);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
