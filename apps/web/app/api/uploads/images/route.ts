import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl, SESSION_COOKIE } from '../../../../lib/session';

/**
 * Multipart uploads can't go through lib/api.ts's apiFetch(), which
 * always forces `Content-Type: application/json` — a multipart boundary
 * must come from fetch() itself reading the FormData body, never set by
 * hand. Otherwise this is the same BFF pattern as every other route:
 * read the httpOnly session cookie, forward as a Bearer token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
  outgoingForm.append('file', file, (file as File).name ?? 'upload');

  const response = await fetch(`${getApiUrl()}/uploads/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: outgoingForm,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: body?.error?.message ?? 'No se pudo subir la imagen.' },
      {
        status: response.status,
      },
    );
  }
  return NextResponse.json(body, { status: response.status });
}
