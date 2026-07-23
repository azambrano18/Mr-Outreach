import { NextRequest, NextResponse } from 'next/server';
import type { SequenceImportSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { importId: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const result = await apiFetch<SequenceImportSummary>(
      `/sequence-imports/${params.importId}/mapping`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
