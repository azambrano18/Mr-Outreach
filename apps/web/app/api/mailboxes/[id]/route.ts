import { NextRequest, NextResponse } from 'next/server';
import type { MailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const mailbox = await apiFetch<MailboxSummary>(`/mailboxes/${params.id}`);
    return NextResponse.json(mailbox);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const mailbox = await apiFetch<MailboxSummary>(`/mailboxes/${params.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(mailbox);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await apiFetch<void>(`/mailboxes/${params.id}`, { method: 'DELETE' });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
