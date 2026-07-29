import { NextRequest, NextResponse } from 'next/server';
import type { AuditLogEntry } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const entries = await apiFetch<AuditLogEntry[]>(`/mailboxes/${params.id}/audit-log`);
    return NextResponse.json(entries);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
