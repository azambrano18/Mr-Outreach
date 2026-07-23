import { NextRequest, NextResponse } from 'next/server';
import type { MailboxInboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const inbox = await apiFetch<MailboxInboxSummary>(`/mailboxes/${params.id}/inbox`);
    return NextResponse.json(inbox);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
