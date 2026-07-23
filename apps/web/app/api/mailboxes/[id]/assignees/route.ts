import { NextRequest, NextResponse } from 'next/server';
import type { AssigneeSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const assignees = await apiFetch<AssigneeSummary[]>(`/mailboxes/${params.id}/assignees`);
    return NextResponse.json(assignees);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const assignees = await apiFetch<AssigneeSummary[]>(`/mailboxes/${params.id}/assignees`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return NextResponse.json(assignees);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
