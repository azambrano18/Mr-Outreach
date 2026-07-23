import { NextRequest, NextResponse } from 'next/server';
import type { ResetPasswordResult } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch<ResetPasswordResult>(`/users/${params.id}/reset-password`, {
      method: 'POST',
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
