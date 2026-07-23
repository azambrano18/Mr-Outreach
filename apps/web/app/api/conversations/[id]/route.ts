import { NextRequest, NextResponse } from 'next/server';
import type { ConversationDetail } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const conversation = await apiFetch<ConversationDetail>(`/conversations/${params.id}`);
    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
