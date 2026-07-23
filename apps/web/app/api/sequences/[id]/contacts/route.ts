import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const search = request.nextUrl.search;
    const contacts = await apiFetch<Record<string, unknown>[]>(`/sequences/${params.id}/contacts${search}`);
    return NextResponse.json(contacts);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
