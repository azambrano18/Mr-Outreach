'use client';

import { useEffect, useState } from 'react';

interface DemoTokenScenario {
  key: string;
  label: string;
  token: string;
}

const SCENARIO_ORDER = ['VALID', 'EXPIRED', 'USED', 'REVOKED', 'DISCONNECTED', 'NO_SEND'];

/**
 * Dev-only helper (§5) — visible only when the backend actually returns
 * tokens, which only happens when MAILBOX_MOTOR_DRIVER=simulated (the
 * backend 404s otherwise, and this panel silently renders nothing).
 */
export function DemoTokensPanel() {
  const [scenarios, setScenarios] = useState<DemoTokenScenario[] | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mailboxes/dev/demo-tokens')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: DemoTokenScenario[] | null) => {
        if (!cancelled && body) {
          setScenarios(
            [...body].sort((a, b) => SCENARIO_ORDER.indexOf(a.key) - SCENARIO_ORDER.indexOf(b.key)),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!scenarios || scenarios.length === 0) {
    return null;
  }

  async function copy(token: string, key: string): Promise<void> {
    await navigator.clipboard.writeText(token);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-brand-300 bg-brand-50/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
        Tokens de prueba (modo simulado — solo desarrollo)
      </p>
      <p className="text-xs text-slate-500">
        Representan la cuenta demo Empresa Demostración / empresademostracion.cl. Nunca disponibles cuando
        el motor está en modo http.
      </p>
      <ul className="flex flex-col gap-1.5">
        {scenarios.map((scenario) => (
          <li key={scenario.key} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs shadow-sm">
            <span className="font-medium text-slate-700">{scenario.label}</span>
            <button
              type="button"
              onClick={() => copy(scenario.token, scenario.key)}
              className="shrink-0 rounded border border-slate-300 px-2 py-1 font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              {copiedKey === scenario.key ? 'Copiado' : 'Copiar'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
