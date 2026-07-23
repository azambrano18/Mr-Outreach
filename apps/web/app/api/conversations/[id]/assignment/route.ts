import { NextRequest, NextResponse } from 'next/server';
import type { ConversationSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const conversation = await apiFetch<ConversationSummary>(
      `/conversations/${params.id}/assignment`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
