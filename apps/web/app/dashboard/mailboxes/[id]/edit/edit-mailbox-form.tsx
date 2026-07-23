'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import type { MailboxEncryption, MailboxSummary } from '@outreach/shared-types';
import { StatusBadge } from '../../../../../components/integration/status-badge';
import {
  deriveMailboxLinkStatus,
  mailboxLinkStatusLabel,
  mailboxLinkStatusTone,
} from '../../../../../lib/mailbox-link-status';
import { MailboxToggleStatusButton } from './mailbox-toggle-status-button';
import { TestConnectionButton } from './test-connection-button';

interface ProtocolFormState {
  host: string;
  port: string;
  encryption: MailboxEncryption;
  username: string;
  password: string;
  verifyCertificate: boolean;
}

function fromSummary(config: MailboxSummary['imap']): ProtocolFormState {
  return {
    host: config.host,
    port: String(config.port),
    encryption: config.encryption,
    username: config.username,
    password: '',
    verifyCertificate: config.verifyCertificate,
  };
}

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
          type="password"
          placeholder="Dejar en blanco para mantener la actual"
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

export function EditMailboxForm({ mailbox }: { mailbox: MailboxSummary }) {
  const router = useRouter();
  const [name, setName] = useState(mailbox.name);
  const [email, setEmail] = useState(mailbox.email);
  const [fromName, setFromName] = useState(mailbox.fromName);
  const [replyTo, setReplyTo] = useState(mailbox.replyTo ?? '');
  const [imap, setImap] = useState<ProtocolFormState>(fromSummary(mailbox.imap));
  const [smtp, setSmtp] = useState<ProtocolFormState>(fromSummary(mailbox.smtp));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Reused across retries of the SAME logical attempt so the engine never links twice (spec §3.4).
  const idempotencyKeyRef = useRef<string | null>(null);
  const linkStatus = deriveMailboxLinkStatus(mailbox);

  function toProtocolPatch(value: ProtocolFormState, original: MailboxSummary['imap']) {
    const patch: Record<string, unknown> = {};
    if (value.host !== original.host) patch.host = value.host;
    if (Number(value.port) !== original.port) patch.port = Number(value.port);
    if (value.encryption !== original.encryption) patch.encryption = value.encryption;
    if (value.username !== original.username) patch.username = value.username;
    if (value.verifyCertificate !== original.verifyCertificate) {
      patch.verifyCertificate = value.verifyCertificate;
    }
    if (value.password) patch.password = value.password;
    return patch;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          fromName,
          replyTo: replyTo || undefined,
          imap: toProtocolPatch(imap, mailbox.imap),
          smtp: toProtocolPatch(smtp, mailbox.smtp),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudieron guardar los cambios.');
        return;
      }

      // Spec §3.1 — saving automatically generates and sends the linking
      // command to the engine; the account is never shown as vinculada just
      // because it was saved locally, only once the engine confirms it.
      if (mailbox.clientId && mailbox.domainId) {
        if (!idempotencyKeyRef.current) {
          idempotencyKeyRef.current = crypto.randomUUID();
        }
        const provisionResponse = await fetch(`/api/mailboxes/${mailbox.id}/provision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: idempotencyKeyRef.current }),
        });
        if (provisionResponse.ok) {
          idempotencyKeyRef.current = null; // this attempt succeeded — a future save gets a fresh key
          await fetch(`/api/mailboxes/${mailbox.id}/provision/advance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'ALL' }),
          });
        }
      }

      router.refresh();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Estado de vinculación
        </span>
        <StatusBadge label={mailboxLinkStatusLabel(linkStatus)} tone={mailboxLinkStatusTone(linkStatus)} />
      </div>
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

      <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Guardando…' : 'Actualizar configuración'}
        </button>
        <TestConnectionButton mailboxId={mailbox.id} />
        <MailboxToggleStatusButton mailboxId={mailbox.id} active={mailbox.status === 'ACTIVE'} />
      </div>
    </form>
  );
}
