import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** Fase 2, Caso C — thin passthrough; forwards the client-generated Idempotency-Key verbatim (never regenerates it). */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get('idempotency-key');
  try {
    const result = await apiFetch<Record<string, unknown>>(`/sequences/${params.id}/publish`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
