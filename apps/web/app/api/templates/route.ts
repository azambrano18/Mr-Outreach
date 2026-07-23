import { NextRequest, NextResponse } from 'next/server';
import type { TemplateSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const templates = await apiFetch<TemplateSummary[]>('/templates');
    return NextResponse.json(templates);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  try {
    const template = await apiFetch<TemplateSummary>('/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
