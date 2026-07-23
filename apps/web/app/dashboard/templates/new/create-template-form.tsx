'use client';

import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { VariableSummary } from '@outreach/shared-types';
import { TemplateVariablesHint } from '../template-variables-hint';
import { VariablePicker } from '../variable-picker';

type ActiveField = 'subject' | 'body';

export function CreateTemplateForm({
  availableVariables,
}: {
  availableVariables: VariableSummary[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>('body');
  const [pendingCursor, setPendingCursor] = useState<{
    field: ActiveField;
    position: number;
  } | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Runs synchronously right after React commits the inserted token to the
  // DOM — a requestAnimationFrame callback here arrives a frame too late: a
  // fast typist's next keystroke lands before the cursor moves, scrambling
  // the text into the wrong position.
  useLayoutEffect(() => {
    if (!pendingCursor) return;
    const el = pendingCursor.field === 'subject' ? subjectRef.current : bodyRef.current;
    el?.focus();
    el?.setSelectionRange(pendingCursor.position, pendingCursor.position);
    setPendingCursor(null);
  }, [pendingCursor]);

  function insertVariable(key: string): void {
    const token = `{${key}}`;
    const el = activeField === 'subject' ? subjectRef.current : bodyRef.current;
    const value = activeField === 'subject' ? subject : body;
    const setValue = activeField === 'subject' ? setSubject : setBody;

    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setValue(next);
    setPendingCursor({ field: activeField, position: start + token.length });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subject, body }),
      });

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        setError(responseBody.error ?? 'No se pudo crear el texto.');
        return;
      }

      router.push('/dashboard/templates');
      router.refresh();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="template-name">
        Nombre
        <input
          id="template-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>

      <VariablePicker variables={availableVariables} onInsert={insertVariable} />

      <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="template-subject">
        Asunto
        <input
          id="template-subject"
          ref={subjectRef}
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onFocus={() => setActiveField('subject')}
          placeholder="Hola {nombre}, ..."
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <TemplateVariablesHint text={subject} />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="template-body">
        Cuerpo
        <textarea
          id="template-body"
          ref={bodyRef}
          required
          rows={8}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onFocus={() => setActiveField('body')}
          placeholder={'Hola {nombre},\n\n...'}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <TemplateVariablesHint text={body} />
      </label>

      <p className="text-xs text-slate-500">
        Usa <code className="rounded bg-slate-100 px-1 py-0.5">{'{nombre}'}</code> para insertar
        variables — solo letras, números y guion bajo, sin empezar con número.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Creando…' : 'Crear texto'}
      </button>
    </form>
  );
}
