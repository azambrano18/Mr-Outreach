import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const execution = await apiFetch(`/me/sequence-executions/${params.id}`);
    return NextResponse.json(execution);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

/** §10 — only while the Gestión is DRAFT; enforced server-side. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const execution = await apiFetch(`/me/sequence-executions/${params.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(execution);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

/** §10 — only while the Gestión is DRAFT; never sends anything to Railway. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch(`/me/sequence-executions/${params.id}`, { method: 'DELETE' });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
