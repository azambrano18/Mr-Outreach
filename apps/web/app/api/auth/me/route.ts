import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/session';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  return NextResponse.json({ user });
}
