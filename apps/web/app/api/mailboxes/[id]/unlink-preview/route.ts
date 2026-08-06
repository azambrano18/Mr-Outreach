import { NextRequest, NextResponse } from 'next/server';
import type { MailboxUnlinkPreview } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** Read-only preflight for "Desvincular cuenta" — thin passthrough, never writes anything. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const preview = await apiFetch<MailboxUnlinkPreview>(`/mailboxes/${params.id}/unlink-preview`);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
