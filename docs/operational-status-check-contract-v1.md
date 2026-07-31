# Contrato del servidor motor — OPERATIONAL_STATUS_CHECK (v1, propuesto, NO implementado)

**Estado: borrador para revisión conjunta con el equipo responsable del
motor. Ningún adaptador real existe todavía. No ejecutar como si este
documento ya fuera el comportamiento del sistema.** Este documento existe
para ser entregado al responsable del servidor motor y acordar el contrato
antes de escribir una sola línea de código de integración real.

Bloqueador relacionado: `docs/database-architecture.md` §20.5/§22.
`ClientEligibilityService.assertEligibleForPublish` hoy solo evalúa el
snapshot local (`ManagedClient.externalStatusSnapshot`) — nunca hace esta
llamada. Este documento no cambia eso; solo prepara el contrato para
cuando se apruebe implementarla.

## 1. Objetivo

Antes de publicar una Plantilla o iniciar una Gestión, Mr Outreach necesita
saber si el cliente, el dominio y/o la cuenta de correo involucrados siguen
operativos **según el motor** (no solo según el último snapshot local
guardado en Mr Outreach), para no publicar/iniciar algo que el motor de
todos modos va a rechazar o que corresponde a una cuenta ya revocada,
suspendida o desvinculada del lado del servidor.

## 2. Momento exacto en que Mr Outreach realiza la consulta

Dos puntos de invocación posibles, ambos **antes** de cualquier escritura
local irreversible:

1. `PublishSequenceTemplateUseCase`, inmediatamente antes de crear el
   `IntegrationCommand` `TEMPLATE_PUBLISH_REQUESTED` (Etapa A de su propio
   patrón de 3 etapas — ver `database-architecture.md` §20.3).
2. `StartSequenceExecutionUseCase`, inmediatamente antes de crear el
   `IntegrationCommand` `SEQUENCE_EXECUTION_START_REQUESTED`, mismo punto.

En ningún caso se llama dentro de una transacción Postgres abierta — es una
llamada de red, igual que el resto de los adaptadores HTTP existentes
(`HttpMailboxMotorAdapter`, `HttpSequenceTemplateMotorAdapter`,
`HttpSequenceExecutionMotorAdapter`).

## 3. Autenticación

**No decidido — dos opciones, ninguna implementada:**

- **Opción A**: el mismo mecanismo que ya usan los demás adaptadores HTTP
  salientes de Mr Outreach hacia el motor (`MAILBOX_MOTOR_API_KEY` /
  equivalente) — Mr Outreach es quien llama, así que la autenticación la
  exige y define el motor.
- **Opción B**: si el motor prefiriera empujar el resultado como un evento
  entrante en vez de que Mr Outreach lo consulte activamente, el esquema
  HMAC ya construido para `POST /integration/events` (Fase "Recepción de
  eventos del motor" — mismo `MotorEventAuthenticator`, mismo esquema
  `hex(HMAC-SHA256(secret, "timestamp.rawBody"))`) es reutilizable tal
  cual, sin inventar un segundo mecanismo.

Esta sección se completa cuando el responsable del motor confirme cuál.

## 4. Endpoint o commandType

Dos formas posibles, coherentes con lo que el motor ya soporte:

- **HTTP síncrono**: `POST /v1/operational-status/check`.
- **Comando versionado**, reutilizando el mismo mecanismo de
  `IntegrationCommand`/`IntegrationEvent` ya existente: `commandType =
  "OPERATIONAL_STATUS_CHECK"`.

Ver §20 para la recomendación.

## 5. Versión del contrato

`schemaVersion: "1.0"` — mismo campo y misma semántica que el resto de los
contratos de este proyecto (`EventEnvelope`, `MotorEventEnvelopeDto`,
`SequenceTemplateVersion`, etc.): un cambio incompatible incrementa este
valor, nunca se reinterpreta un valor existente.

## 6. Request

```json
{
  "schemaVersion": "1.0",
  "commandType": "OPERATIONAL_STATUS_CHECK",
  "commandId": "cmd_uuid",
  "correlationId": "corr_uuid",
  "idempotencyKey": "idem_uuid",
  "requestedAt": "2026-07-31T15:00:00.000Z",
  "organizationId": "org_...",
  "serverClientId": "client_...",
  "serverDomainId": "domain_...",
  "serverMailboxId": "mailbox_...",
  "operation": "TEMPLATE_PUBLISH | EXECUTION_START"
}
```

`serverDomainId`/`serverMailboxId` son opcionales cuando la operación no
los involucra todavía (p. ej. una Plantilla puede publicarse antes de que
exista una Gestión con mailbox concreto — a confirmar con el motor cuál
combinación es válida para cada `operation`).

## 7. Response

```json
{
  "schemaVersion": "1.0",
  "commandId": "cmd_uuid",
  "correlationId": "corr_uuid",
  "checkedAt": "2026-07-31T15:00:00.000Z",
  "serverClientId": "client_...",
  "serverDomainId": "domain_...",
  "serverMailboxId": "mailbox_...",
  "clientStatus": "ACTIVE",
  "domainStatus": "ACTIVE",
  "mailboxStatus": "ACTIVE",
  "eligible": true,
  "blockReasonCode": null,
  "blockReason": null,
  "motorStatusCode": "OPERATIONAL"
}
```

## 8. Estados admitidos

`clientStatus` / `domainStatus` / `mailboxStatus` ∈:

| Estado | Significado |
|---|---|
| `ACTIVE` | Operativo, sin restricciones conocidas por el motor. |
| `INACTIVE` | Existe pero no está habilitado para operar. |
| `SUSPENDED` | Suspendido temporalmente (motivo en `blockReason`). |
| `REVOKED` | Acceso revocado — nunca reversible sin una nueva vinculación. |
| `UNLINKED` | Existía una vinculación y ya no existe. |
| `NOT_FOUND` | El motor no reconoce este identificador. |
| `UNKNOWN` | El motor no pudo determinar el estado (nunca se interpreta como `ACTIVE`). |

`eligible: true` requiere los 3 estados relevantes en `ACTIVE` — el motor
decide la agregación final, Mr Outreach nunca la infiere combinando los 3
campos por su cuenta (evita que un criterio local diverja silenciosamente
del criterio real del motor).

## 9. Códigos de error

| HTTP / código | Significado | Acción de Mr Outreach |
|---|---|---|
| `400` | Request malformado o `schemaVersion` no soportada | Bloquear, nunca reintentar sin corregir |
| `401`/`403` | Autenticación inválida | Bloquear, alertar — nunca continuar sin autenticación válida |
| `404` | Identificador no reconocido por el motor | Bloquear (`blockReasonCode = "NOT_FOUND"`) |
| `409` | Conflicto de estado (a definir con el motor) | Bloquear, registrar para revisión manual |
| `5xx` | Error del motor | Bloquear (fail-closed — ver §15), un reintento (ver §11) |
| timeout | Sin respuesta dentro del plazo | Bloquear (fail-closed), un reintento |

Nunca se expone el detalle interno de un error 5xx al usuario final de Mr
Outreach — mismo principio que el resto de los controladores del proyecto
(nunca stack traces, nunca mensajes internos del motor verbatim).

## 10. Timeout

5 segundos — igual al resto de los adaptadores HTTP salientes existentes
(`HttpMailboxMotorAdapter`, `HttpSequenceTemplateMotorAdapter`,
`HttpSequenceExecutionMotorAdapter`), por consistencia operativa.

## 11. Reintentos

1 reintento, solo ante timeout o `5xx` — nunca ante `400`/`401`/`403`/`404`
(errores que un reintento idéntico no puede resolver). Mismo
`idempotencyKey` en el reintento; nunca uno nuevo.

## 12. Idempotencia

`idempotencyKey` identifica la CONSULTA, no muta ningún estado del lado
del motor (es una lectura) — su propósito aquí es puramente de
trazabilidad y deduplicación de reintentos, no de idempotencia de
escritura como en `IntegrationCommand`.

## 13. `correlationId`

Generado por Mr Outreach al iniciar el flujo de publicación/inicio;
permite correlacionar esta consulta con el `IntegrationCommand` que
eventualmente se cree si la consulta resulta elegible — mismo campo,
mismo propósito que en `EventEnvelope`/`MotorEventEnvelopeDto`.

## 14. `commandId`, si corresponde

Solo si se implementa como Opción B de §4 (comando versionado) — en ese
caso, `commandId` sigue el mismo patrón que `IntegrationCommand`
(`findByCommandId` scoped por `organizationId`, nunca cruza organización).
No aplica si se implementa como Opción A (HTTP síncrono directo).

## 15. Fail-closed

Bloquear la publicación o el inicio cuando **cualquiera** de estas
condiciones ocurra — nunca asumir elegibilidad por defecto:

- el motor no responde;
- se agota el timeout (tras el reintento de §11);
- falla la autenticación;
- la respuesta trae una `schemaVersion` incompatible;
- algún identificador de la respuesta no coincide con el de la request;
- cualquiera de `clientStatus`/`domainStatus`/`mailboxStatus` no es
  `ACTIVE`;
- `eligible` no es `true`;
- la respuesta es estructuralmente inconsistente (falta un campo
  requerido, tipos inesperados, etc.).

Mismo principio ya aplicado en este proyecto para
`MotorEventAuthenticator.isConfigured()` (§ HMAC) y para
`SequenceExecutionMotorPort`/`SequenceTemplateMotorPort`: ante duda,
bloquear, nunca "por ahora dejar pasar".

## 16. Actualización del snapshot local

Una respuesta exitosa actualiza `ManagedClient.externalStatusSnapshot` /
`externalStatusCheckedAt` (campos ya existentes desde la fase de
eliminación del CRM) en una transacción **nueva**, posterior a la
respuesta de red — nunca dentro de la misma transacción que la llamada,
y nunca reteniendo una transacción abierta durante la espera de red. Un
fallo fail-closed (§15) **no** actualiza el snapshot — el snapshot solo
se mueve hacia adelante con evidencia real y reciente del motor.

## 17. Auditoría

Cada consulta (éxito o fail-closed) genera un `AuditLog`:
`action: "operational_status_check.performed"` con metadata
`{ operation, clientStatus, domainStatus, mailboxStatus, eligible,
blockReasonCode, motorStatusCode, correlationId }` — nunca credenciales,
nunca el cuerpo completo de la respuesta del motor si llegara a incluir
algo sensible.

## 18. Ejemplos completos

**Elegible:**

```json
// Request
{ "schemaVersion": "1.0", "commandType": "OPERATIONAL_STATUS_CHECK", "commandId": "cmd_1", "correlationId": "corr_1", "idempotencyKey": "idem_1", "requestedAt": "2026-07-31T15:00:00.000Z", "organizationId": "org_1", "serverClientId": "client_1", "serverDomainId": "domain_1", "serverMailboxId": "mailbox_1", "operation": "EXECUTION_START" }
// Response
{ "schemaVersion": "1.0", "commandId": "cmd_1", "correlationId": "corr_1", "checkedAt": "2026-07-31T15:00:01.200Z", "serverClientId": "client_1", "serverDomainId": "domain_1", "serverMailboxId": "mailbox_1", "clientStatus": "ACTIVE", "domainStatus": "ACTIVE", "mailboxStatus": "ACTIVE", "eligible": true, "blockReasonCode": null, "blockReason": null, "motorStatusCode": "OPERATIONAL" }
```

**Bloqueado — mailbox revocado:**

```json
// Response
{ "schemaVersion": "1.0", "commandId": "cmd_2", "correlationId": "corr_2", "checkedAt": "2026-07-31T15:05:00.000Z", "serverClientId": "client_1", "serverDomainId": "domain_1", "serverMailboxId": "mailbox_2", "clientStatus": "ACTIVE", "domainStatus": "ACTIVE", "mailboxStatus": "REVOKED", "eligible": false, "blockReasonCode": "MAILBOX_REVOKED", "blockReason": "La cuenta fue revocada por el cliente el 2026-07-20.", "motorStatusCode": "MAILBOX_REVOKED" }
```

**Fail-closed — timeout:** Mr Outreach nunca envía este caso como request;
es el resultado LOCAL cuando no llega response alguna tras el reintento de
§11 — se trata igual que `eligible: false, blockReasonCode:
"MOTOR_UNAVAILABLE"` para efectos de la decisión de bloqueo, sin inventar
un `checkedAt`/`motorStatusCode` que el motor nunca emitió.

## 19. Casos límite

- **Cliente activo, dominio revocado**: `eligible: false` — un dominio
  revocado bloquea toda operación bajo él, sin importar el estado del
  cliente.
- **Reintento tras un 5xx que en realidad sí se procesó del lado del
  motor**: el `idempotencyKey` debe permitir al motor devolver la MISMA
  respuesta en vez de recalcular o, peor, fallar por duplicado — a
  confirmar que el motor trata esta consulta de solo lectura como
  segura de repetir sin efectos secundarios (debería serlo, al no mutar
  nada).
- **`serverMailboxId` aún no existe** (Plantilla publicada antes de tener
  una Gestión con mailbox concreto): el motor debe devolver `NOT_FOUND`
  para ese campo específico sin fallar toda la consulta, si la operación
  no lo requiere — a confirmar con el motor.
- **Motor responde con una `schemaVersion` más nueva que la que Mr
  Outreach entiende**: fail-closed (§15) — nunca se intenta parsear
  "lo que se entienda" de una versión desconocida.

## 20. Responsabilidades del motor

- Ser la única fuente de verdad de `clientStatus`/`domainStatus`/
  `mailboxStatus`.
- Nunca devolver `eligible: true` si internamente considera que la
  operación fallaría.
- Responder de forma idempotente al mismo `idempotencyKey`.
- Confirmar cuál de las dos opciones de autenticación (§3) y de
  transporte (§4) prefiere.
- Confirmar los casos límite de §19.

## 21. Responsabilidades de Mr Outreach

- Nunca asumir elegibilidad sin una respuesta explícita y reciente.
- Nunca cachear el resultado más allá de la operación que lo solicitó
  (cada publicación/inicio hace su propia consulta — no se reutiliza un
  resultado de hace unos minutos).
- Actualizar el snapshot local solo con evidencia real (§16).
- Auditar cada consulta (§17).
- Nunca implementar esta llamada real hasta que este documento esté
  aprobado por ambas partes.

## Recomendación de Mr Outreach (no vinculante — decisión pendiente conjunta)

Entre las opciones de §3/§4, **se recomienda la Opción A de autenticación
(mismo mecanismo que los demás adaptadores HTTP salientes) combinada con
transporte HTTP síncrono (§4)** — es el patrón que este proyecto ya usa
para toda comunicación Mr-Outreach-llama-al-motor
(`HttpMailboxMotorAdapter`, `HttpSequenceTemplateMotorAdapter`,
`HttpSequenceExecutionMotorAdapter`), evita introducir un mecanismo nuevo
solo para este caso, y una consulta de elegibilidad síncrona antes de
publicar/iniciar encaja naturalmente como una llamada de solicitud/
respuesta, no como un evento asíncrono. La alternativa (comando
versionado vía `IntegrationCommand`, Opción B) queda documentada por si
el equipo del motor ya tiene esa vía preferida por otras razones
operativas — **la decisión final requiere aprobación conjunta**, esta
sección no autoriza a implementar ninguna de las dos por sí sola.

---

**No implementar ningún adaptador real contra este contrato hasta que el
responsable del motor lo confirme explícitamente.** Este documento no
resuelve el bloqueador documentado en `database-architecture.md` §20.5 —
solo lo prepara para su resolución futura.
