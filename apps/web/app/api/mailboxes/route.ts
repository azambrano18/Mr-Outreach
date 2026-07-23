import { NextRequest, NextResponse } from 'next/server';
import type { MailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  try {
    const mailbox = await apiFetch<MailboxSummary>('/mailboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(mailbox, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
