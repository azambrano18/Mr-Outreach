import { NextRequest, NextResponse } from 'next/server';
import type { ConversationTreeClientNode } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const tree = await apiFetch<ConversationTreeClientNode[]>(`/clients/${params.id}/conversations/tree`);
    return NextResponse.json(tree);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
