import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** §14 — preflight estimate for the "Confirmar actualización de plantilla" modal; no motor call happens here. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const impact = await apiFetch(`/me/sequence-templates/${params.id}/update-impact`, { method: 'POST' });
    return NextResponse.json(impact);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
