import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../../lib/api';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; tagId: string } },
): Promise<NextResponse> {
  try {
    await apiFetch<void>(`/me/conversations/${params.id}/tags/${params.tagId}`, {
      method: 'DELETE',
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
