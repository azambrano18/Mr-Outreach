import { NextRequest, NextResponse } from 'next/server';
import type { MailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const mailbox = await apiFetch<MailboxSummary>(`/mailboxes/${params.id}/deactivate`, {
      method: 'POST',
    });
    return NextResponse.json(mailbox);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
