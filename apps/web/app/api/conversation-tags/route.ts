import { NextRequest, NextResponse } from 'next/server';
import type { ConversationTagSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const tags = await apiFetch<ConversationTagSummary[]>('/conversation-tags');
    return NextResponse.json(tags);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  try {
    const tag = await apiFetch<ConversationTagSummary>('/conversation-tags', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
