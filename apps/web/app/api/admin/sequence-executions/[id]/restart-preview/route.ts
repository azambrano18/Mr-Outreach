import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch(`/admin/sequence-executions/${params.id}/restart-preview`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
