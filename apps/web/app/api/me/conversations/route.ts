import { NextRequest, NextResponse } from 'next/server';
import type { ConversationSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const conversations = await apiFetch<ConversationSummary[]>(
      `/me/conversations${request.nextUrl.search}`,
    );
    return NextResponse.json(conversations);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
