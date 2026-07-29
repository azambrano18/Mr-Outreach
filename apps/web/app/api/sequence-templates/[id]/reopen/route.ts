import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** §11 — reopens an archived Plantilla as an editable draft. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const template = await apiFetch(`/me/sequence-templates/${params.id}/reopen`, { method: 'POST' });
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
