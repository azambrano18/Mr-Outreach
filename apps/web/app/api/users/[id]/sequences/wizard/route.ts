import { NextRequest, NextResponse } from 'next/server';
import type { SequenceSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const sequence = await apiFetch<SequenceSummary>(`/users/${params.id}/sequences/wizard`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(sequence, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
