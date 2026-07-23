import { NextRequest, NextResponse } from 'next/server';
import type { ProvisioningCommandView } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await apiFetch<ProvisioningCommandView>(`/mailboxes/${params.id}/provision/command`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
