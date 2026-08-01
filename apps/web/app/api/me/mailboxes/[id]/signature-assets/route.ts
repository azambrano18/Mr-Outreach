import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl, SESSION_COOKIE } from '../../../../../../lib/session';

/**
 * Fase 2 (R2) — same multipart BFF pattern as /api/uploads/images: a
 * multipart boundary must come from fetch() reading the FormData body
 * itself, never set by hand, so this can't go through lib/api.ts's
 * apiFetch() (which forces Content-Type: application/json).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  }

  const incomingForm = await request.formData();
  const file = incomingForm.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });
  }

  const outgoingForm = new FormData();
  outgoingForm.append('file', file, (file as File).name ?? 'imagen');

  const response = await fetch(`${getApiUrl()}/me/mailboxes/${params.id}/signature-assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: outgoingForm,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: body?.error?.message ?? body?.message ?? 'No se pudo subir la imagen.' },
      { status: response.status },
    );
  }
  return NextResponse.json(body, { status: response.status });
}
