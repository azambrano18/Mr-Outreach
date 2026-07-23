import { NextRequest, NextResponse } from 'next/server';
import type { AdminSequenceListRow } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const search = request.nextUrl.search;
    const rows = await apiFetch<AdminSequenceListRow[]>(`/sequences${search}`);
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
