'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AssignedMailboxSummary } from '@outreach/shared-types';

const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 120;

export function NewSequenceTemplateForm({ mailboxes }: { mailboxes: AssignedMailboxSummary[] }) {
  const router = useRouter();
  const [mailboxId, setMailboxId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMailbox = useMemo(() => mailboxes.find((m) => m.id === mailboxId) ?? null, [mailboxes, mailboxId]);
  const trimmedName = name.trim();

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch('/api/sequence-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailboxId, name: trimmedName, description: description || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo crear la plantilla.');
        return;
      }
      router.push(`/dashboard/sequence-templates/${body.id}`);
      router.refresh();
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setSaving(false);
    }
  }

  if (mailboxes.length === 0) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        No tienes ninguna cuenta de correo asignada todavía. Pide a un administrador que te asigne una cuenta antes
        de crear una plantilla.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Cuenta de correo
        <select
          required
          value={mailboxId}
          onChange={(event) => setMailboxId(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Selecciona una cuenta</option>
          {mailboxes.map((mailbox) => (
            <option key={mailbox.id} value={mailbox.id}>
              {mailbox.email}
            </option>
          ))}
        </select>
      </label>

      {selectedMailbox && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Cliente</span>
            <span className="text-slate-800">{selectedMailbox.clientName ?? '—'}</span>
          </div>
          <div>
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Dominio</span>
            <span className="text-slate-800">{selectedMailbox.domainName ?? '—'}</span>
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Nombre de la plantilla
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={NAME_MIN_LENGTH}
          maxLength={NAME_MAX_LENGTH}
          placeholder="Prospección Gerentes de Recursos Humanos"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <span className="text-xs text-slate-500">
          Identifica el propósito de esta plantilla (por ejemplo, a quién está dirigida o para qué campaña). Se
          mantiene igual en todas sus versiones.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Descripción (opcional)
        <textarea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !mailboxId || trimmedName.length < NAME_MIN_LENGTH}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Creando…' : 'Crear plantilla'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard/sequence-templates')}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
