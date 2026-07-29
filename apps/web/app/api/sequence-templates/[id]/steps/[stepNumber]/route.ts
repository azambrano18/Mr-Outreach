import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; stepNumber: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const template = await apiFetch(`/me/sequence-templates/${params.id}/steps/${params.stepNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
