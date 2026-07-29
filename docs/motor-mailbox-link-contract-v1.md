# Contrato del servidor motor — vinculación de cuentas por token (v1)

Fase 2.1. Este documento es la única fuente de verdad del contrato conceptual
entre Mr Outreach y el servidor motor para el flujo de vinculación de cuentas
de correo. Ningún adaptador (`SimulatedMailboxMotorAdapter`,
`HttpMailboxMotorAdapter`) puede desviarse de estas formas sin actualizar
primero este documento.

`HttpMailboxMotorAdapter` (`apps/api/src/infrastructure/mailbox-motor/http/`)
ya implementa este contrato contra un servidor HTTP real siguiendo exactamente
estas rutas y estos mapeos de código de estado — pero **ningún servidor
Railway real existe todavía para probarlo contra uno de verdad**; solo se ha
verificado con un servidor HTTP simulado en las pruebas unitarias del propio
adaptador. La configuración por defecto (`MAILBOX_MOTOR_DRIVER=simulated`)
sigue usando `SimulatedMailboxMotorAdapter` — cambiar a `http` requiere
`MAILBOX_MOTOR_BASE_URL` y `MAILBOX_MOTOR_API_KEY` (validados al arrancar,
ver env.validation.ts).

Puerto de aplicación correspondiente:
`apps/api/src/domain/mailbox-motor/mailbox-motor-port.ts`.

## Principios

- El motor es la única fuente de verdad de credenciales, cliente y dominio.
- Ningún endpoint de este contrato devuelve ni permite recuperar contraseñas,
  refresh tokens OAuth, claves de cifrado o connection strings.
- El token de vinculación es de un solo uso, vence en 24 horas y es revocable.
- Mr Outreach nunca decodifica ni confía en el token localmente: toda
  decisión de validez pasa por `introspect` o `redeem` contra el motor.
- Todas las operaciones de escritura (`redeem`, `unlink`) son idempotentes
  mediante `Idempotency-Key`.

## 1. Introspección

`POST /v1/mailbox-link-tokens/introspect`

Solo lectura. Nunca redime el token, nunca crea nada.

**Entrada**

```json
{ "token": "<token>" }
```

**Respuesta** — siempre 200 para un token reconocido, sin importar su
estado; `valid`/`status` indican por qué no puede usarse:

```json
{
  "valid": true,
  "tokenId": "tok_123",
  "status": "ISSUED",
  "expiresAt": "2026-07-25T15:00:00Z",
  "mailbox": {
    "serverMailboxId": "mbx_123",
    "email": "ventas@cliente.cl",
    "displayName": "Ventas",
    "status": "CONNECTED",
    "canSend": true
  },
  "domain": { "serverDomainId": "dom_456", "name": "cliente.cl" },
  "client": { "serverClientId": "client_789", "crmClientId": 88, "name": "Cliente Ejemplo" }
}
```

`status` ∈ `ISSUED | EXPIRED | REVOKED | REDEEMED`.

Errores: `400` token malformado/no reconocido (nunca revela si alguna vez
existió); `503` motor no disponible.

## 2. Redención

`POST /v1/mailbox-link-tokens/redeem`

**Entrada**: token, `Idempotency-Key`, organización externa de Mr Outreach,
actor.

**Respuesta**

```json
{
  "redemptionId": "red_789",
  "tokenId": "tok_123",
  "status": "REDEEMED",
  "redeemedAt": "2026-07-24T15:00:00Z",
  "mailbox": { "serverMailboxId": "mbx_123", "email": "ventas@cliente.cl", "displayName": "Ventas", "status": "CONNECTED", "canSend": true },
  "domain": { "serverDomainId": "dom_456", "name": "cliente.cl" },
  "client": { "serverClientId": "client_789", "crmClientId": 88, "name": "Cliente Ejemplo" }
}
```

Reglas:
- Redención repetida por la **misma** organización (mismo o distinto
  `Idempotency-Key`, mismo token) devuelve el **mismo** comprobante — nunca
  crea una segunda redención ni otra cuenta.
- Redención por **otra** organización sobre un token ya redimido → `409`.
- Token vencido o revocado → `410 Gone`.
- Token malformado/no reconocido → `400`.
- Motor no disponible → `503`.

## 3. Estado actual

`GET /v1/mailboxes/:serverMailboxId/status`

```json
{
  "serverMailboxId": "mbx_123",
  "linkStatus": "ACTIVE",
  "technicalStatus": "CONNECTED",
  "canSend": true,
  "checkedAt": "2026-07-24T15:10:00Z"
}
```

`linkStatus` ∈ `ACTIVE | REVOKED`. `technicalStatus` ∈ `CONNECTED | DEGRADED
| DISCONNECTED | DISABLED | UNKNOWN`. Errores: `503` motor no disponible
(fail-closed — nunca se sustituye por el último snapshot local).

## 4. Desvinculación

`POST /v1/mailboxes/:serverMailboxId/unlink`

**Entrada**: `Idempotency-Key`, organización solicitante, actor, motivo,
`correlationId`.

**Respuesta**

```json
{ "serverMailboxId": "mbx_123", "status": "REVOKED", "revocationId": "rev_456", "revokedAt": "2026-07-24T16:00:00Z" }
```

Idempotente: una segunda solicitud equivalente (o sobre una cuenta ya
`REVOKED`) devuelve el mismo comprobante. Si el motor no puede confirmar la
revocación en este intento → `503`; Mr Outreach debe mantener el estado local
en `UNLINK_REQUESTED` y permitir reintentar, nunca reactivar la cuenta.

## 5. Reglas obligatorias del motor

- Rechaza tokens vencidos, revocados, o ya utilizados por otra organización.
- Una redención repetida con la misma intención recupera el mismo
  comprobante; nunca crea otra cuenta por un reintento.
- Invalida tokens `ISSUED` pendientes asociados a una cuenta que sea
  revocada.
- Rechaza comandos posteriores provenientes de un vínculo revocado.
- Nunca expone credenciales en ninguna respuesta de este contrato.

## Mapeo de errores HTTP (Mr Outreach → motor)

| Código | Causa |
|---|---|
| 400 | Token malformado o DTO inválido |
| 404 | Ejecutivo u otro recurso local inexistente |
| 409 | Token ya redimido por otra organización / mailbox ya vinculado / cuenta revocada o desconectada |
| 410 | Token vencido / revocado / ya no utilizable |
| 503 | Motor no disponible o timeout en cualquiera de las 4 operaciones |

## Historial de versiones

- **v1** (2026-07-24, Fase 2.1): versión inicial. Implementada únicamente
  contra `SimulatedMailboxMotorAdapter`; `HttpMailboxMotorAdapter` existía
  como estructura preparada, sin conexión real.
- **v1.1** (2026-07-24, Fase 2.1): `HttpMailboxMotorAdapter` implementado
  (fetch + Bearer + Idempotency-Key + X-Correlation-Id + timeout +
  mapeo 400/409/410/503), cubierto por pruebas unitarias contra un fetch
  simulado. Sigue sin conexión contra un servidor Railway real — nadie ha
  desplegado uno todavía.
