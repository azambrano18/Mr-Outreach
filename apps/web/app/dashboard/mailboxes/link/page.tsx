import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../../lib/session';
import { DemoTokensPanel } from './demo-tokens-panel';
import { LinkMailboxForm } from './link-mailbox-form';

/**
 * Fase 2.1 — the only way to add a mailbox: paste a token issued by the
 * motor server. There is no manual IMAP/SMTP creation flow anymore.
 */
export default async function LinkMailboxPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.link')) {
    redirect('/dashboard/mailboxes');
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Vincular cuenta de correo</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pega el token generado por el servidor motor para incorporar una cuenta ya creada y configurada
          ahí. Mr Outreach nunca crea clientes, dominios ni credenciales — solo lee lo que el token informa.
        </p>
      </div>
      <DemoTokensPanel />
      <LinkMailboxForm />
    </div>
  );
}
