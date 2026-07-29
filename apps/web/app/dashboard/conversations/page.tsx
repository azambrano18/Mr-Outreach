import { redirect } from 'next/navigation';

/**
 * "Conversaciones" — admin-only nav entry (see lib/admin-navigation.ts).
 * A pure redirect alias, exactly like /dashboard/mail-accounts is for the
 * executive: it forwards straight into the executive's own conversations
 * module (/dashboard/mailboxes/mine → AccountsWorkspace), never a second
 * implementation. Query params (e.g. `mailboxId` from a mailbox detail
 * page's "Ver conversaciones" action) are forwarded so deep links work.
 */
export default function ConversationsAliasPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const query = params.toString();
  redirect(`/dashboard/mailboxes/mine${query ? `?${query}` : ''}`);
}
