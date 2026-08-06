'use client';

import { useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@outreach/shared-types';
import { BrandMark } from '../brand';
import { getPostLoginDestination } from '../../lib/post-login-destination';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        setError('Correo o contraseña incorrectos.');
        setLoading(false);
        return;
      }

      const { user } = (await response.json()) as { user: AuthenticatedUser };
      const destination = getPostLoginDestination(user);

      // A full navigation (not router.push) is intentional: it makes the
      // browser issue a brand-new request that carries the just-set httpOnly
      // cookie through middleware and the dashboard's Server Components, so
      // getCurrentUser() and mustChangePassword are evaluated fresh instead
      // of reusing an RSC tree computed before login.
      window.location.replace(destination);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark />
        <h1 className="text-2xl font-semibold text-slate-900">Iniciar sesión</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
      >
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Correo
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
