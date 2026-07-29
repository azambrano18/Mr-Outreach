import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '../../../../../lib/api';

/**
 * Dev-only helper (§5) — forwards to the backend, which itself 404s unless
 * MAILBOX_MOTOR_DRIVER=simulated. Never talks to any motor directly from
 * the browser.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const tokens = await apiFetch<Record<string, unknown>[]>('/mailboxes/dev/demo-tokens');
    return NextResponse.json(tokens, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
