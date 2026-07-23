import { NextRequest, NextResponse } from 'next/server';
import type { MailboxConnectionTestSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const history = await apiFetch<MailboxConnectionTestSummary[]>(
      `/mailboxes/${params.id}/connection-tests`,
    );
    return NextResponse.json(history);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
