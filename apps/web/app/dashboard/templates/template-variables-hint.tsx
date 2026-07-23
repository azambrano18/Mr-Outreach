'use client';

import { validateTemplateVariables } from '@outreach/validation';

export function TemplateVariablesHint({ text }: { text: string }) {
  const result = validateTemplateVariables(text);

  if (!text.trim()) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {result.variables.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.variables.map((variable) => (
            <span
              key={variable}
              className="rounded-full bg-brand-100 px-2 py-0.5 font-mono text-xs text-brand-700"
            >
              {`{${variable}}`}
            </span>
          ))}
        </div>
      )}
      {result.errors.map((error) => (
        <p key={error} className="text-xs text-red-600">
          {error}
        </p>
      ))}
    </div>
  );
}
