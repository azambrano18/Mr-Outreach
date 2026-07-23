import Link from 'next/link';
import type { ReadinessResponse } from '@outreach/shared-types';
import { BrandMark } from './brand';

type ReadinessState =
  { reachable: true; data: ReadinessResponse } | { reachable: false; message: string };

async function getApiReadiness(): Promise<ReadinessState> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  try {
    const response = await fetch(`${apiUrl}/health/ready`, { cache: 'no-store' });
    const data = (await response.json()) as ReadinessResponse;
    return { reachable: true, data };
  } catch {
    return {
      reachable: false,
      message: `No se pudo contactar la API en ${apiUrl}. ¿Está corriendo "npm run start:dev -w apps/api"?`,
    };
  }
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

export default async function HomePage() {
  const readiness = await getApiReadiness();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <BrandMark />
          <h1 className="text-2xl font-semibold text-slate-900">Panel de prospección</h1>
        </div>
        <Link
          href="/login"
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Iniciar sesión
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
        <h2 className="text-sm font-medium text-slate-500">Estado de la API</h2>

        {readiness.reachable ? (
          <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Servicio</dt>
            <dd>
              <StatusPill ok={readiness.data.status === 'ok'} label={readiness.data.status} />
            </dd>
            <dt className="text-slate-500">Modalidad</dt>
            <dd className="font-mono text-xs text-slate-600">{readiness.data.mode}</dd>
            <dt className="text-slate-500">Persistencia</dt>
            <dd>
              <StatusPill
                ok={readiness.data.persistence.status !== 'unavailable'}
                label={`${readiness.data.persistence.driver} · ${readiness.data.persistence.status}`}
              />
            </dd>
            <dt className="text-slate-500">Motor</dt>
            <dd>
              <StatusPill
                ok={readiness.data.engine.status !== 'unavailable'}
                label={`${readiness.data.engine.driver} · ${readiness.data.engine.status}`}
              />
            </dd>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-red-600">{readiness.message}</p>
        )}
      </div>
    </main>
  );
}
