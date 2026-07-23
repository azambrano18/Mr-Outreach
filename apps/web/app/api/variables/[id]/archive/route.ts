import { NextRequest, NextResponse } from 'next/server';
import type { VariableSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const variable = await apiFetch<VariableSummary>(`/variables/${params.id}/archive`, {
      method: 'POST',
    });
    return NextResponse.json(variable);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
