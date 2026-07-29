import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/**
 * Fase 2.1, Paso 1 de "Vincular cuenta con token" — read-only passthrough.
 * Never persists the token; the backend itself never redeems it here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  try {
    const result = await apiFetch<Record<string, unknown>>('/mailboxes/link-token/introspect', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
