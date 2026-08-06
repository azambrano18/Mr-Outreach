'use client';

import { useState, type FormEvent } from 'react';
import { BrandMark } from '../../brand';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo cambiar la contraseña.');
        setLoading(false);
        return;
      }

      // Full navigation, not router.push: forces DashboardLayout to query
      // /auth/me again from scratch and see mustChangePassword=false,
      // instead of risking a stale RSC tree from before the change.
      window.location.replace('/dashboard');
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark />
        <h1 className="text-2xl font-semibold text-slate-900">Cambia tu contraseña</h1>
        <p className="text-sm text-slate-500">
          Debes definir una contraseña nueva antes de continuar. La contraseña temporal ya no será válida
          después de este paso.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
      >
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Contraseña actual (temporal)
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Nueva contraseña
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <span className="text-xs text-slate-500">
            Al menos 10 caracteres, con mayúsculas, minúsculas y números.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </main>
  );
}
