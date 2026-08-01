import { redirect } from 'next/navigation';
import type { UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ExecutivesList } from './executives-list';

export default async function ExecutivesPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('users.read')) {
    return <AccessDenied />;
  }

  let executives: UserSummary[] = [];
  let loadError: string | null = null;
  try {
    executives = await apiFetch<UserSummary[]>('/users');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
  }

  const canCreate = currentUser.permissions.includes('users.create');

  return <ExecutivesList executives={executives} loadError={loadError} canCreate={canCreate} />;
}
