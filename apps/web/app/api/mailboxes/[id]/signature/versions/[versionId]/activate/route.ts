import { NextRequest, NextResponse } from 'next/server';
import type { SignatureSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; versionId: string } },
): Promise<NextResponse> {
  try {
    const signature = await apiFetch<SignatureSummary>(
      `/mailboxes/${params.id}/signature/versions/${params.versionId}/activate`,
      { method: 'POST' },
    );
    return NextResponse.json(signature);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
