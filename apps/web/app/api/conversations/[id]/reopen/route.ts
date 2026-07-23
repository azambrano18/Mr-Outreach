import { NextRequest, NextResponse } from 'next/server';
import type { ConversationSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const conversation = await apiFetch<ConversationSummary>(
      `/conversations/${params.id}/reopen`,
      { method: 'POST' },
    );
    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
