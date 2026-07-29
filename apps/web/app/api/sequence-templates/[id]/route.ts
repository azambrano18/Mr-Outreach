import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const template = await apiFetch(`/me/sequence-templates/${params.id}`);
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const template = await apiFetch(`/me/sequence-templates/${params.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

/** §8-10 — behavior depends on the Plantilla's current status (hard delete / logical delete / blocked); see SequenceTemplatesService.deleteTemplate. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch(`/me/sequence-templates/${params.id}`, { method: 'DELETE' });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
