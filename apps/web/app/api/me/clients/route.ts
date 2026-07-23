import { NextRequest, NextResponse } from 'next/server';
import type { ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const clients = await apiFetch<ManagedClientSummary[]>('/me/clients');
    return NextResponse.json(clients);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
