import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { batchId: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch(`/admin/simulation-conversations/${params.batchId}`, { method: 'DELETE' });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
