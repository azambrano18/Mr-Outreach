import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { executionId: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const result = await apiFetch(`/dev/simulated/executions/${params.executionId}/state`, {
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
