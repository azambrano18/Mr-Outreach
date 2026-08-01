import { redirect } from 'next/navigation';
import type { MailboxAdminOverviewItem } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { MailboxesList } from './mailboxes-list';

export default async function MailboxesOverviewPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('mailboxes.read.all')) {
    return <AccessDenied />;
  }

  const canLink = currentUser.permissions.includes('mailboxes.link');

  let items: MailboxAdminOverviewItem[] = [];
  let loadError: string | null = null;
  try {
    items = await apiFetch<MailboxAdminOverviewItem[]>('/mailboxes/overview');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar el listado.';
  }

  return <MailboxesList items={items} loadError={loadError} canLink={canLink} />;
}
