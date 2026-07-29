import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl, SESSION_COOKIE } from '../../../../../lib/session';

/** Multipart forward — see app/api/uploads/images/route.ts's comment for why this can't go through apiFetch(). */
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
  outgoingForm.append('file', file, (file as File).name ?? 'prospectos.xlsx');

  const response = await fetch(`${getApiUrl()}/me/sequence-executions/${params.id}/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: outgoingForm,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: body?.error?.message ?? 'No se pudo subir el archivo.' },
      { status: response.status },
    );
  }
  return NextResponse.json(body, { status: response.status });
}
