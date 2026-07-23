import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch(`/integration/events/${params.eventId}/reprocess`, { method: 'POST' });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
