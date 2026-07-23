import { NextResponse } from 'next/server';
import type { IntegrationSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const result = await apiFetch<IntegrationSummary>('/integration/summary');
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
