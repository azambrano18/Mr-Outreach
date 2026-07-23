import { NextRequest, NextResponse } from 'next/server';
import type { SignaturePreview } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const preview = await apiFetch<SignaturePreview>(`/mailboxes/${params.id}/signature/preview`);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
