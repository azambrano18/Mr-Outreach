import Link from 'next/link';

/**
 * Shown when the backend has already rejected the request (403) for a
 * permission-gated page. This is a display concern only — the real
 * enforcement already happened server-side; this just keeps the user
 * from landing on a bare, unstyled sentence with no way back. Rendered
 * inside the dashboard shell, so the sidebar/topbar stay visible.
 */
export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-full rounded-lg border border-red-200 bg-red-50 p-6">
        <h1 className="text-lg font-semibold text-red-700">Acceso denegado</h1>
        <p className="mt-2 text-sm text-red-600">
          {message ?? 'No tienes permiso para ver esta sección.'}
        </p>
      </div>
      <Link href="/dashboard" className="text-sm font-medium text-brand-700 underline">
        Volver al panel
      </Link>
    </div>
  );
}
