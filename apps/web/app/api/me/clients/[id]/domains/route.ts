import { NextRequest, NextResponse } from 'next/server';
import type { DomainSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const domains = await apiFetch<DomainSummary[]>(`/me/clients/${params.id}/domains`);
    return NextResponse.json(domains);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
