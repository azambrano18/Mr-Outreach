import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { importId: string } },
): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  try {
    const result = await apiFetch<Record<string, unknown>>(
      `/sequence-imports/${params.importId}/confirm`,
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
