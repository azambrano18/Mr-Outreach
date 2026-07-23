import { NextRequest, NextResponse } from 'next/server';
import type { IntegrationEvent } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await apiFetch<IntegrationEvent[]>(`/integration/events${request.nextUrl.search}`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
