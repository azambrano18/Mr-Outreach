import { NextRequest, NextResponse } from 'next/server';
import type { ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  try {
    const client = await apiFetch<ManagedClientSummary>('/clients', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
