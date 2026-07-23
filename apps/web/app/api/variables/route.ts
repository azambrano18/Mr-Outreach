import { NextRequest, NextResponse } from 'next/server';
import type { VariableSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const variables = await apiFetch<VariableSummary[]>('/variables');
    return NextResponse.json(variables);
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
    const variable = await apiFetch<VariableSummary>('/variables', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(variable, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
