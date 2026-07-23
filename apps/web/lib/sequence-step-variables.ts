/**
 * Mirrors sequence-variable-resolver.ts in the API: {sender.*}/{mailbox.*}
 * (resolved from real executive/organization/mailbox data) plus a
 * {contact.*} namespace that always falls back to a generic sample —
 * there is no Contact entity yet (see README > "Fase 10").
 */
export const SEQUENCE_STEP_VARIABLES: { key: string; label: string }[] = [
  { key: 'contact.firstName', label: 'Contacto: nombre' },
  { key: 'contact.lastName', label: 'Contacto: apellido' },
  { key: 'contact.fullName', label: 'Contacto: nombre completo' },
  { key: 'contact.email', label: 'Contacto: correo' },
  { key: 'contact.company', label: 'Contacto: empresa' },
  { key: 'contact.jobTitle', label: 'Contacto: cargo' },
  { key: 'contact.city', label: 'Contacto: ciudad' },
  { key: 'contact.country', label: 'Contacto: país' },
  { key: 'sender.name', label: 'Remitente: nombre completo' },
  { key: 'sender.firstName', label: 'Remitente: nombre' },
  { key: 'sender.lastName', label: 'Remitente: apellido' },
  { key: 'sender.email', label: 'Remitente: correo' },
  { key: 'sender.company', label: 'Remitente: empresa' },
  { key: 'mailbox.email', label: 'Cuenta: correo' },
];
