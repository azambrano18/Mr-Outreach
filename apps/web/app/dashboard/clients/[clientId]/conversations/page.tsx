import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type {
  AdminSequenceListRow,
  ClientAssigneeSummary,
  ConversationDetail,
  ConversationTreeClientNode,
  ManagedClientSummary,
} from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { AccessDenied } from '../../../access-denied';
import { AccountsWorkspace } from '../../../../../components/accounts/accounts-workspace';

interface SearchParams {
  clientId?: string;
  domainId?: string;
  mailboxId?: string;
  conversationId?: string;
}

/**
 * Spec §7 — the admin views a client's conversations through the EXACT same
 * interface the executive already uses (`AccountsWorkspace`), just scoped to
 * this one client and with extra filters — never a second, different UI.
 */
export default async function ClientConversationsPage({
  params,
  searchParams,
}: {
  params: { clientId: string };
  searchParams: SearchParams;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  const canReadAll = currentUser.permissions.includes('conversations.read.all');
  const canReadAssigned = currentUser.permissions.includes('conversations.read.assigned');
  if (!canReadAll && !canReadAssigned) {
    return <AccessDenied />;
  }

  const clientBase = canReadAll ? '/clients' : '/me/clients';
  let client: ManagedClientSummary;
  try {
    client = await apiFetch<ManagedClientSummary>(`${clientBase}/${params.clientId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const basePath = canReadAll ? '/api/conversations' : '/api/me/conversations';

  // Fetch detail FIRST when deep-linked — that call marks the conversation
  // read server-side, so the tree fetched right after already reflects the
  // decremented unread count.
  let initialDetail: ConversationDetail | null = null;
  if (searchParams.conversationId) {
    try {
      initialDetail = await apiFetch<ConversationDetail>(
        `${canReadAll ? '/conversations' : '/me/conversations'}/${searchParams.conversationId}`,
      );
    } catch {
      initialDetail = null;
    }
  }

  let tree: ConversationTreeClientNode[] = [];
  let executives: ClientAssigneeSummary[] = [];
  let sequenceOptions: { id: string; name: string }[] = [];
  let loadError: string | null = null;
  try {
    if (canReadAll) {
      const [fullTree, assignees, sequenceRows] = await Promise.all([
        apiFetch<ConversationTreeClientNode[]>(`/clients/${params.clientId}/conversations/tree`),
        apiFetch<ClientAssigneeSummary[]>(`/clients/${params.clientId}/assignees`),
        apiFetch<AdminSequenceListRow[]>(`/sequences?clientId=${params.clientId}`),
      ]);
      tree = fullTree;
      executives = assignees;
      sequenceOptions = sequenceRows.map((row) => ({ id: row.id, name: row.name }));
    } else {
      const fullTree = await apiFetch<ConversationTreeClientNode[]>('/me/conversations/tree');
      tree = fullTree.filter((node) => node.id === params.clientId);
    }
  } catch (error) {
    loadError =
      error instanceof ApiError ? error.message : 'No se pudieron cargar las conversaciones del cliente.';
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div>
        <Link
          href={`/dashboard/clients/${params.clientId}`}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          ← {client.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Conversaciones de {client.name}</h1>
        <p className="text-sm text-slate-500">
          Respuestas y trazabilidad de los prospectos de este cliente, organizadas por dominio y
          cuenta — de solo lectura y gestión operativa. No permite redactar ni enviar correos desde
          aquí.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <AccountsWorkspace
          tree={tree}
          initialSelection={{
            clientId: params.clientId,
            domainId: searchParams.domainId ?? null,
            mailboxId: searchParams.mailboxId ?? null,
            conversationId: searchParams.conversationId ?? null,
          }}
          initialDetail={initialDetail}
          mode={canReadAll ? 'admin' : 'self'}
          basePath={basePath}
          executives={executives}
          sequences={sequenceOptions}
        />
      )}
    </div>
  );
}
