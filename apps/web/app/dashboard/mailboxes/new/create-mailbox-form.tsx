'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { MailboxEncryption } from '@outreach/shared-types';

interface ProtocolFormState {
  host: string;
  port: string;
  encryption: MailboxEncryption;
  username: string;
  password: string;
  verifyCertificate: boolean;
}

const EMPTY_PROTOCOL: ProtocolFormState = {
  host: '',
  port: '',
  encryption: 'SSL_TLS',
  username: '',
  password: '',
  verifyCertificate: true,
};

function ProtocolFields({
  label,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  value: ProtocolFormState;
  onChange: (next: ProtocolFormState) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">{label}</legend>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor={`${idPrefix}-host`}>
          Host
          <input
            id={`${idPrefix}-host`}
            required
            value={value.host}
            onChange={(event) => onChange({ ...value, host: event.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor={`${idPrefix}-port`}>
          Puerto
          <input
            id={`${idPrefix}-port`}
            required
            type="number"
            min={1}
            max={65535}
            value={value.port}
            onChange={(event) => onChange({ ...value, port: event.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
      </div>

      <label
        className="flex flex-col gap-1 text-sm text-slate-700"
        htmlFor={`${idPrefix}-encryption`}
      >
        Cifrado
        <select
          id={`${idPrefix}-encryption`}
          value={value.encryption}
          onChange={(event) =>
            onChange({ ...value, encryption: event.target.value as MailboxEncryption })
          }
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="SSL_TLS">SSL/TLS</option>
          <option value="STARTTLS">STARTTLS</option>
          <option value="NONE">Ninguno</option>
        </select>
      </label>

      <label
        className="flex flex-col gap-1 text-sm text-slate-700"
        htmlFor={`${idPrefix}-username`}
      >
        Usuario
        <input
          id={`${idPrefix}-username`}
          required
          value={value.username}
          onChange={(event) => onChange({ ...value, username: event.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>

      <label
        className="flex flex-col gap-1 text-sm text-slate-700"
        htmlFor={`${idPrefix}-password`}
      >
        Contraseña
        <input
          id={`${idPrefix}-password`}
          required
          type="password"
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={value.verifyCertificate}
          onChange={(event) => onChange({ ...value, verifyCertificate: event.target.checked })}
        />
        Validar certificado
      </label>
    </fieldset>
  );
}

export function CreateMailboxForm({
  domainId,
  clientId,
}: {
  domainId?: string;
  clientId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [imap, setImap] = useState<ProtocolFormState>(EMPTY_PROTOCOL);
  const [smtp, setSmtp] = useState<ProtocolFormState>(EMPTY_PROTOCOL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          fromName,
          replyTo: replyTo || undefined,
          imap: { ...imap, port: Number(imap.port) },
          smtp: { ...smtp, port: Number(smtp.port) },
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo registrar la cuenta.');
        return;
      }

      if (domainId) {
        await fetch(`/api/mailboxes/${body.id}/link-domain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domainId }),
        });

        // Spec §3.1 — saving automatically generates and sends the linking
        // command to the engine; the account is never shown as vinculada
        // just because it was saved locally.
        const provisionResponse = await fetch(`/api/mailboxes/${body.id}/provision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        });
        if (provisionResponse.ok) {
          await fetch(`/api/mailboxes/${body.id}/provision/advance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'ALL' }),
          });
        }
      }

      router.push(
        domainId && clientId ? `/dashboard/clients/${clientId}/domains/${domainId}` : '/dashboard/clients',
      );
      router.refresh();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="mailbox-name">
          Nombre visible de la cuenta
          <input
            id="mailbox-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="mailbox-email">
          Dirección de correo
          <input
            id="mailbox-email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="mailbox-from-name">
          Nombre del remitente
          <input
            id="mailbox-from-name"
            required
            value={fromName}
            onChange={(event) => setFromName(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="mailbox-reply-to">
          Reply-To (opcional)
          <input
            id="mailbox-reply-to"
            type="email"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
      </div>

      <ProtocolFields label="IMAP" value={imap} onChange={setImap} idPrefix="imap" />
      <ProtocolFields label="SMTP" value={smtp} onChange={setSmtp} idPrefix="smtp" />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Registrando…' : 'Guardar y vincular cuenta'}
      </button>
    </form>
  );
}
