import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const executions = await apiFetch('/me/sequence-executions');
    return NextResponse.json(executions);
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
    const execution = await apiFetch('/me/sequence-executions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(execution);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
