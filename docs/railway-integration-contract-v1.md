# Contrato del servidor motor Railway — Plantillas y Gestiones (v1)

Consolidación contractual previa a la integración con Railway. Este documento
es la única fuente de verdad del contrato conceptual entre Mr Outreach y el
servidor motor Railway para **publicación de versiones de Plantilla** e
**inicio de Gestiones**. Ningún adaptador (`SimulatedSequenceTemplateMotorAdapter`
/`HttpSequenceTemplateMotorAdapter`, `SimulatedSequenceExecutionMotorAdapter`
/`HttpSequenceExecutionMotorAdapter`) puede desviarse de estas formas sin
actualizar primero este documento.

`HttpSequenceTemplateMotorAdapter` (`apps/api/src/infrastructure/sequence-template-motor/http/`)
y `HttpSequenceExecutionMotorAdapter` (`apps/api/src/infrastructure/sequence-execution-motor/http/`)
ya implementan este contrato contra un servidor HTTP real siguiendo
exactamente estas rutas — pero **ningún servidor Railway real existe todavía
para probarlo contra uno de verdad**; solo se ha verificado con un servidor
HTTP simulado en las pruebas de contrato de ambos adaptadores
(`http-sequence-template-motor-adapter.spec.ts`,
`http-sequence-execution-motor-adapter.spec.ts`). La configuración por
defecto (`SEQUENCE_MOTOR_MODE=simulated`) sigue usando los adaptadores
simulados — cambiar a `http` requiere `SEQUENCE_MOTOR_BASE_URL` y
`SEQUENCE_MOTOR_API_KEY` (validados al arrancar, ver `env.validation.ts`; la
API rechaza iniciar si falta cualquiera de las dos).

Puertos de aplicación correspondientes:
`apps/api/src/domain/sequence-template-motor/sequence-template-motor-port.ts`,
`apps/api/src/domain/sequence-execution-motor/sequence-execution-motor-port.ts`.

La vinculación de cuentas de correo (token, `MailboxMotorPort`) es un
contrato **separado e independiente** de este — ver
`docs/motor-mailbox-link-contract-v1.md`. Este documento no lo repite ni lo
modifica.

## Principios (regla definitiva de versionado)

- **Una Gestión siempre utiliza una versión inmutable de Plantilla.** El
  contenido congelado en `SequenceTemplateVersion` (asunto, cuerpos,
  programación, firma) nunca cambia después de publicarse.
- **Editar una Plantilla publicada crea una versión nueva** — nunca
  modifica la anterior "en sitio". No existe ningún comando de "actualizar"
  distinto: publicar por primera vez y publicar una nueva versión usan
  exactamente el mismo comando (`TEMPLATE_VERSION_PUBLISH`).
- **Cada versión aceptada recibe un `serverTemplateId` nuevo y único**
  (`SequenceTemplateVersion.serverTemplateId @unique` en el esquema). Nunca
  se reutiliza el `serverTemplateId` de una versión anterior.
- **La nueva versión se utiliza solamente en nuevas Gestiones.** Las
  Gestiones activas continúan usando su versión original — no se envía
  ninguna instrucción sobre Gestiones activas al publicar una nueva versión,
  y no existe ningún alcance `FUTURE_UNSENT_JOBS` ni campo equivalente en
  este contrato.
- **Railway administra el procesamiento internamente.** Mr Outreach nunca
  envía cola, prioridad, responsable técnico, fecha/hora programada,
  `initialStep`, `serverMailboxId` ni `templateToken` en el comando de inicio
  de Gestión — solo `serverTemplateId` + la base normalizada.
- Todas las operaciones de escritura (`publish`, `start`) son idempotentes
  mediante `Idempotency-Key`.

## Autenticación

Todas las solicitudes llevan:

```
Authorization: Bearer <SEQUENCE_MOTOR_API_KEY>
```

La API key nunca se registra en logs (`HttpSequenceTemplateMotorAdapter`/
`HttpSequenceExecutionMotorAdapter` solo registran la ruta solicitada en caso
de fallo de red, nunca la URL base completa ni la key — ver sus pruebas de
contrato, caso "sin secretos en logs").

## Headers comunes

| Header            | Obligatorio | Descripción                                          |
| ------------------ | ----------- | ----------------------------------------------------- |
| `Content-Type`      | Sí          | Siempre `application/json`.                           |
| `Authorization`     | Sí          | `Bearer <SEQUENCE_MOTOR_API_KEY>`.                     |
| `Idempotency-Key`   | Sí          | Reenviar la misma clave en un reintento nunca crea un segundo recurso remoto. |
| `X-Correlation-Id`  | Sí          | Correlaciona un comando con su cadena de eventos/logs. |

## 1. Publicación de versión de Plantilla

`POST /v1/sequence-templates/publish`

Un único comando (`TEMPLATE_VERSION_PUBLISH`) para la primera publicación de
una Plantilla **y** para cada versión posterior ("editar plantilla
publicada"). No existe un comando `.../update` separado.

- Primera publicación → `template.previousServerTemplateId: null`.
- Nueva versión de una Plantilla ya publicada →
  `template.previousServerTemplateId` = el `serverTemplateId` de la versión
  ACCEPTED inmediatamente anterior — **puramente informativo para la
  auditoría de Railway**, nunca una instrucción para modificar esa versión
  ni las Gestiones que la usan.

### Entrada real (JSON generado por `HttpSequenceTemplateMotorAdapter`, caso "nueva versión")

```json
{
  "schemaVersion": "1.0",
  "commandType": "TEMPLATE_VERSION_PUBLISH",
  "commandId": "3c7ebe8a-6f5d-4cc0-b3a9-cb5ca84b4a55",
  "idempotencyKey": "a3f1e6b2-9c4d-4e8a-8b1f-2d5c7a9e0f3b",
  "correlationId": "c7d2b4a8-1e6f-4c3a-9b5d-8f0e2a1c6d4b",
  "organizationId": "16f8176c-2960-4e53-95b5-8aea87565834",
  "executiveUserId": "2b9d4804-954f-4943-bbca-217babd0b3a8",
  "template": {
    "localTemplateId": "a9a8df66-858e-47bd-b0fc-ea50db9a9bc1",
    "previousServerTemplateId": "tplv_server_001",
    "name": "Prospección Gerentes de RR. HH.",
    "version": 2,
    "serverMailboxId": "mbx_server_001",
    "mailboxEmail": "ventas.demo@mejoreferido-demo.test",
    "timezone": "America/Santiago",
    "subjectTemplate": "Hola {contact_name}, información para {company_name}",
    "signatureHtml": "<div>Equipo de Ventas</div>",
    "variables": [
      { "key": "contact_name", "required": false },
      { "key": "company_name", "required": false }
    ],
    "sends": [
      {
        "sendNumber": 1,
        "headerText": null,
        "bodyHtml": "<p>Cuerpo del envío 1.</p>",
        "schedule": {
          "type": "EXECUTION_START_UNTIL_19",
          "allowedWeekdays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
          "sendWindowEnd": "19:00"
        }
      },
      {
        "sendNumber": 2,
        "headerText": null,
        "bodyHtml": "<p>Cuerpo del envío 2.</p>",
        "schedule": {
          "delayValue": 5,
          "delayUnit": "BUSINESS_DAYS",
          "allowedWeekdays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
          "sendWindowStart": "08:00",
          "sendWindowEnd": "19:00"
        }
      },
      {
        "sendNumber": 3,
        "headerText": null,
        "bodyHtml": "<p>Cuerpo del envío 3.</p>",
        "schedule": {
          "delayValue": 5,
          "delayUnit": "BUSINESS_DAYS",
          "allowedWeekdays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
          "sendWindowStart": "08:00",
          "sendWindowEnd": "19:00"
        }
      }
    ]
  }
}
```

Nota sobre `schedule`: el Envío 1 nunca tiene espera — corre desde el inicio
de la Gestión hasta las 19:00 del mismo corte fijo, por lo que su `schedule`
lleva `type: "EXECUTION_START_UNTIL_19"` en vez de `delayValue`/`delayUnit`.
Los Envíos 2/3 siempre llevan `delayValue`/`delayUnit: "BUSINESS_DAYS"`
explícitos (nunca otra unidad), más la ventana fija `08:00–19:00`.
`bodyText` (versión en texto plano) también viaja en cada `send`, omitida
arriba por brevedad.

### Respuesta esperada

```json
{
  "accepted": true,
  "serverTemplateId": "tplv_server_002",
  "templateToken": "tpt_a1b2c3d4e5f6",
  "version": 2,
  "status": "ACCEPTED",
  "acceptedAt": "2026-07-29T18:00:00.000Z",
  "rejectionReason": null
}
```

`serverTemplateId` es **siempre nuevo** frente al de la versión anterior —
nunca el mismo valor que `previousServerTemplateId`. `status` ∈
`ACCEPTED | FAILED`; un rechazo de negocio es `{accepted: false, status:
"FAILED", rejectionReason: "..."}`, nunca una excepción HTTP.

## 2. Consulta de estado de una versión

`GET /v1/sequence-templates/:serverTemplateId/status`

```json
{ "serverTemplateId": "tplv_server_002", "status": "ACCEPTED", "checkedAt": "2026-07-29T18:10:00.000Z" }
```

## 3. Inicio de Gestión

`POST /v1/sequence-executions/start`

Contrato deliberadamente mínimo — Mr Outreach nunca envía cola, prioridad,
responsable técnico, fecha/hora programada, `initialStep`, `serverMailboxId`
ni `templateToken`. Railway resuelve la cuenta y la Plantilla internamente a
partir de `serverTemplateId` y registra cada prospecto en `STEP_01_PENDING`
por su propia decisión.

### Entrada real (JSON generado por `HttpSequenceExecutionMotorAdapter`)

```json
{
  "schemaVersion": "3.0",
  "commandType": "SEQUENCE_EXECUTION_START",
  "commandId": "785d8217-e005-4025-b2ba-26908b1870a1",
  "idempotencyKey": "f1a2b3c4-d5e6-4789-9abc-def012345678",
  "correlationId": "01234567-89ab-4cde-8f01-23456789abcd",
  "template": { "serverTemplateId": "tplv_server_002" },
  "execution": { "localExecutionId": "90a77bd4-2e6e-43fc-a7c7-8ebfe3b803a8" },
  "prospects": [
    { "localProspectId": "row_1", "email": "contacto1@empresaneutral.cl", "variables": { "contact_name": "Ana", "company_name": "Empresa Neutral Uno" } },
    { "localProspectId": "row_2", "email": "contacto2@empresaneutral.cl", "variables": { "contact_name": "Pedro", "company_name": "Empresa Neutral Dos" } }
  ]
}
```

### Respuesta esperada

```json
{
  "accepted": true,
  "serverExecutionId": "exec_srv_7f3a9c2b",
  "executionToken": "ext_9f8e7d6c5b4a",
  "status": "ACCEPTED",
  "receivedProspects": 2,
  "acceptedProspects": 2,
  "rejectedProspects": 0,
  "initialProspectState": "STEP_01_PENDING",
  "receivedAt": "2026-07-29T18:05:00.000Z",
  "rejectionReason": null
}
```

`initialProspectState` es opcional en la respuesta — el contrato fija
`STEP_01_PENDING` de todos modos si el servidor lo omite (regla §Estados
más abajo), nunca una instrucción que Mr Outreach envíe.

## 4. Consulta de estado de una Gestión

`GET /v1/sequence-executions/:serverExecutionId/status`

```json
{
  "serverExecutionId": "exec_srv_7f3a9c2b",
  "status": "RUNNING",
  "currentStepNumber": 1,
  "sentCount": 1,
  "pendingCount": 1,
  "failedCount": 0,
  "estimatedStartAt": null,
  "startedAt": "2026-07-29T18:06:00.000Z",
  "lastError": null,
  "checkedAt": "2026-07-29T18:10:00.000Z"
}
```

## Errores

Ningún método de estos dos adaptadores lanza una excepción para un rechazo
de negocio bien formado — eso siempre es `{accepted: false, ...}` en un 200.
Una excepción (`ServiceUnavailableException`, HTTP 503 hacia el cliente de
Mr Outreach) ocurre solo cuando:

- `SEQUENCE_MOTOR_BASE_URL` no está configurada.
- La solicitud de red falla o excede `SEQUENCE_MOTOR_TIMEOUT_MS`.
- El servidor responde con un status HTTP no exitoso (`!response.ok`).
- El cuerpo de una respuesta 2xx no es JSON válido ("Respuesta inválida del
  servidor motor").

## Idempotencia

Reenviar la misma `Idempotency-Key` en `publish` o `start` nunca crea un
segundo recurso remoto — el motor debe devolver el mismo recibo ya emitido.
Verificado en los adaptadores simulados
(`SimulatedSequenceTemplateMotorAdapter`/`SimulatedSequenceExecutionMotorAdapter`)
mediante un mapa `idempotencyKey → resultado` y en las Gestiones reales por
`SequenceExecution.lastSubmissionIdempotencyKey` (reintento reutiliza
exactamente la misma clave del primer intento, ver
`StartSequenceExecutionUseCase`).

## Estados

- Versión de Plantilla: `REQUESTED → ACCEPTED | FAILED` (terminal, nunca
  vuelve a `REQUESTED`; el contenido nunca cambia después de creada).
- Gestión (local): `DRAFT → SUBMITTING → SUBMISSION_UNKNOWN? → ACCEPTED →
  RUNNING → COMPLETED | FAILED | REJECTED`. `serverStatus` (reportado por
  Railway vía `GET .../status`) incluye además `QUEUED`, que siempre
  colapsa al estado local `ACCEPTED` — nunca un estado local propio.

## Regla STEP_01_PENDING

Todo prospecto aceptado en `start` queda registrado por Railway en
`STEP_01_PENDING` por decisión propia del servidor — Mr Outreach nunca envía
esa instrucción; solo la usa como valor por defecto local si la respuesta la
omite (`initialProspectState ?? 'STEP_01_PENDING'` en
`StartSequenceExecutionUseCase`).

## Regla de versiones inmutables

Una vez `ACCEPTED`, ninguno de los campos de contenido de una
`SequenceTemplateVersion` (asunto, cuerpos, programación, firma,
`serverTemplateId`, `templateTokenCiphertext`) se vuelve a escribir. Una
Gestión referencia siempre `templateVersionId`, nunca `templateId` +
"versión vigente" — por eso el historial completo (`findLatestByTemplate`)
y la versión activa (`findLatestAcceptedByTemplate`) son consultas
deliberadamente distintas (ver `SequenceTemplateVersionRepository`).

## Regla: nuevas versiones solo afectan nuevas Gestiones

Publicar una nueva versión:

1. Crea el snapshot local de la nueva versión.
2. Envía el contenido completo a Railway vía `TEMPLATE_VERSION_PUBLISH`.
3. Railway devuelve un `serverTemplateId` nuevo.
4. Mr Outreach guarda la versión como `ACCEPTED`.
5. Esa versión pasa a ser la versión predeterminada para **nuevas**
   Gestiones (`SequenceExecutionsService.requirePublishedTemplate` resuelve
   siempre `findLatestAcceptedByTemplate`).
6. Las Gestiones existentes no cambian — conservan su propio
   `templateVersionId`, fijado en el momento en que fueron creadas.

Caso obligatorio verificado (`sequence-template-versioning.integration.spec.ts`,
contra PostgreSQL real): versión 1 `ACCEPTED`, versión 2 `FAILED` → la
versión activa sigue siendo la 1 (nuevas Gestiones pueden crearse contra
ella), la versión 2 queda visible en el historial como intento fallido, y el
ejecutivo puede corregir y publicar una versión 3 sin que el intento 2
bloquee nada.
