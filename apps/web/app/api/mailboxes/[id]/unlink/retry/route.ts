import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

/** Fase 2.1, §14 — retries the post-commit motor confirmation for a mailbox stuck in UNLINK_REQUESTED. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch<Record<string, unknown>>(`/mailboxes/${params.id}/unlink/retry`, {
      method: 'POST',
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
