import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/** Fase 2.1, §13 — thin passthrough; forwards the client-generated Idempotency-Key verbatim. Never requires a token. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get('idempotency-key');
  try {
    const result = await apiFetch<Record<string, unknown>>(`/mailboxes/${params.id}/primary-executive`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
