import { NextResponse } from 'next/server';
import type { RoleSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const roles = await apiFetch<RoleSummary[]>('/roles');
    return NextResponse.json(roles);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
