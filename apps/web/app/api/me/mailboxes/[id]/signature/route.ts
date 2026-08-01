import { NextRequest, NextResponse } from 'next/server';
import type { SignatureSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const signature = await apiFetch<SignatureSummary>(`/me/mailboxes/${params.id}/signature`);
    return NextResponse.json(signature);
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
    const signature = await apiFetch<SignatureSummary>(`/me/mailboxes/${params.id}/signature`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(signature);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
