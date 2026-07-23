import { NextRequest, NextResponse } from 'next/server';
import type { CreateUserResult, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const users = await apiFetch<UserSummary[]>('/users');
    return NextResponse.json(users);
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
    const user = await apiFetch<CreateUserResult>('/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
