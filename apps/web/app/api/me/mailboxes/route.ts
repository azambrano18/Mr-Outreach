import { NextRequest, NextResponse } from 'next/server';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const mailboxes = await apiFetch<AssignedMailboxSummary[]>('/me/mailboxes');
    return NextResponse.json(mailboxes);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
