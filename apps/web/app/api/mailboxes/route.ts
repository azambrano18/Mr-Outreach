import { NextRequest, NextResponse } from 'next/server';
import type { MailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

/** Read-only — there is no manual mailbox creation anymore; the only way to add a mailbox is POST /mailboxes/link. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const executiveId = request.nextUrl.searchParams.get('executiveId');
  const query = executiveId ? `?executiveId=${encodeURIComponent(executiveId)}` : '';
  try {
    const mailboxes = await apiFetch<MailboxSummary[]>(`/mailboxes${query}`);
    return NextResponse.json(mailboxes);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
