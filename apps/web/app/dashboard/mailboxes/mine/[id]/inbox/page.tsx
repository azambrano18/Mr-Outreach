import { redirect } from 'next/navigation';

/**
 * Superseded by the Outlook-style three-column workspace at
 * /dashboard/mailboxes/mine — this route stays alive only so old links
 * (bookmarks, anything cached client-side) keep working.
 */
export default function MyMailboxInboxRedirect({ params }: { params: { id: string } }) {
  redirect(`/dashboard/mailboxes/mine?mailboxId=${params.id}`);
}
