import { NextResponse } from 'next/server';
import type { ConversationTreeClientNode } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const tree = await apiFetch<ConversationTreeClientNode[]>('/me/conversations/tree');
    return NextResponse.json(tree);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
