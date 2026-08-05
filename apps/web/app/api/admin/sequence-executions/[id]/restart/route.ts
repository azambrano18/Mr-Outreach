import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'El encabezado Idempotency-Key es obligatorio.' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const result = await apiFetch(`/admin/sequence-executions/${params.id}/restart`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
