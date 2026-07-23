import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { commandId: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const result = await apiFetch(`/integration/commands/${params.commandId}/advance`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
