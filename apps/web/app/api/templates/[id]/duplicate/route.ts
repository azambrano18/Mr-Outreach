import { NextRequest, NextResponse } from 'next/server';
import type { TemplateSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const template = await apiFetch<TemplateSummary>(`/templates/${params.id}/duplicate`, {
      method: 'POST',
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
