import { NextRequest, NextResponse } from 'next/server';
import type { MailboxThreadDetail } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; threadId: string } },
): Promise<NextResponse> {
  try {
    const thread = await apiFetch<MailboxThreadDetail>(
      `/me/mailboxes/${params.id}/inbox/threads/${params.threadId}`,
    );
    return NextResponse.json(thread);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
