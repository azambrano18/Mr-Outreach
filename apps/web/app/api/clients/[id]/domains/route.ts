import { NextRequest, NextResponse } from 'next/server';
import type { DomainSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const domains = await apiFetch<DomainSummary[]>(`/clients/${params.id}/domains`);
    return NextResponse.json(domains);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await request.json();
  try {
    const domain = await apiFetch<DomainSummary>(`/clients/${params.id}/domains`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(domain, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
