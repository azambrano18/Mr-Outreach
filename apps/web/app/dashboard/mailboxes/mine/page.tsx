import { redirect } from 'next/navigation';
import type { ConversationDetail, ConversationTreeClientNode } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import { AccountsWorkspace } from '../../../../components/accounts/accounts-workspace';

/**
 * "Cuentas de correos" — the ONLY sidebar item an executive keeps (see
 * lib/admin-navigation.ts). No longer the live-IMAP `MailWorkspace` (Fase
 * 10) — this now shows the persisted `Conversation` model through a
 * Cliente → Dominio → Cuenta tree. The full read/write conversation
 * inbox (message threads, notes, tags) lives per-client instead, at
 * `/dashboard/clients/[clientId]/conversations` — there is no standalone
 * cross-client conversations screen anymore.
 */
export default async function MyMailboxesPage({
  searchParams,
}: {
  searchParams: { clientId?: string; domainId?: string; mailboxId?: string; conversationId?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('mailboxes.read.assigned')) {
    return <AccessDenied />;
  }

  // Fetch the detail FIRST when a conversationId is deep-linked — that call
  // marks the conversation read server-side, so fetching the tree
  // afterwards (not in parallel) means its unread counters already reflect
  // the decrement instead of showing a stale count for one extra render.
  let initialDetail: ConversationDetail | null = null;
  if (searchParams.conversationId) {
    try {
      initialDetail = await apiFetch<ConversationDetail>(`/me/conversations/${searchParams.conversationId}`);
    } catch {
      initialDetail = null;
    }
  }

  let tree: ConversationTreeClientNode[] = [];
  let loadError: string | null = null;
  try {
    tree = await apiFetch<ConversationTreeClientNode[]>('/me/conversations/tree');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la bandeja.';
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Cuentas de correos</h1>
        <p className="text-sm text-slate-500">
          Respuestas y trazabilidad de tus prospectos, organizadas por cliente, dominio y cuenta —
          de solo lectura y gestión operativa. No permite redactar ni enviar correos desde aquí.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <AccountsWorkspace
          tree={tree}
          initialSelection={{
            clientId: searchParams.clientId ?? null,
            domainId: searchParams.domainId ?? null,
            mailboxId: searchParams.mailboxId ?? null,
            conversationId: searchParams.conversationId ?? null,
          }}
          initialDetail={initialDetail}
        />
      )}
    </div>
  );
}
