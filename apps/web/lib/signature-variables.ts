/**
 * The {sender.*}/{mailbox.*} namespace resolved server-side from real
 * executive/organization/mailbox data (see signature-variable-resolver.ts
 * in the API) — distinct from the flat Variable catalog used by Textos.
 */
export const SIGNATURE_VARIABLES: { key: string; label: string }[] = [
  { key: 'sender.name', label: 'Nombre completo' },
  { key: 'sender.firstName', label: 'Nombre' },
  { key: 'sender.lastName', label: 'Apellido' },
  { key: 'sender.email', label: 'Correo del remitente' },
  { key: 'sender.company', label: 'Empresa' },
  { key: 'mailbox.email', label: 'Correo de la cuenta' },
];
