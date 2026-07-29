import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const executions = await apiFetch('/admin/sequence-executions');
    return NextResponse.json(executions);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
