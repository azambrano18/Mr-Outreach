import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../lib/api';

/**
 * Fase 2.1 — the single "intención completa" endpoint for "Vincular cuenta
 * con token". Never coordinates multiple backend calls itself; forwards
 * the client-generated Idempotency-Key verbatim. Never logs or persists
 * the token itself — a thin passthrough only.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  const idempotencyKey = request.headers.get('idempotency-key');
  try {
    const result = await apiFetch<Record<string, unknown>>('/mailboxes/link', {
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
