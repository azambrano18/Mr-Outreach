import { NextRequest, NextResponse } from 'next/server';
import type { ConversationNoteSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const notes = await apiFetch<ConversationNoteSummary[]>(`/me/conversations/${params.id}/notes`);
    return NextResponse.json(notes);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const note = await apiFetch<ConversationNoteSummary>(`/me/conversations/${params.id}/notes`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
