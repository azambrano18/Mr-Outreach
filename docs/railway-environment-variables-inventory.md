# Inventario de variables de entorno para Railway (production)

**Solo inventario — Railway no fue configurado ni modificado.** Ninguna
fila de este documento contiene un valor real; todos los ejemplos están
enmascarados o son placeholders explícitos.

Fuente de verdad para el servicio API:
[`apps/api/src/infrastructure/config/env.validation.ts`](../apps/api/src/infrastructure/config/env.validation.ts)
(Joi valida esto al arrancar — si falta algo requerido, el proceso no
levanta). Fuente de verdad para el servicio Web: cada `process.env.*`
efectivamente referenciado en `apps/web` (verificado por búsqueda directa
en el código, no por inferencia).

## Servicio API (`apps/api`)

| Variable | Obligatoria | Secreto | Origen | Ejemplo enmascarado | Validación runtime |
|---|---|---|---|---|---|
| `NODE_ENV` | Sí | No | Railway (fijo por servicio) | `production` | `Joi.valid('development','staging','production','test')` |
| `PORT` | No (default 3001) | No | Railway (inyectado automáticamente en algunos planes) | `3001` | `Joi.number()` |
| `WEB_ORIGIN` | Sí en production (CORS estricto) | No | Railway | `https://app.***.com` | `Joi.string().uri()` — usado tal cual en `app.enableCors()`, nunca `*` |
| `PERSISTENCE_DRIVER` | Sí | No | Railway (fijo) | `postgres` | `Joi.valid('memory','postgres')` |
| `DATABASE_URL` | Sí (driver=postgres) | **Sí** | Neon → Railway | `postgresql://***:***@ep-***-pooler.***.neon.tech/neondb?sslmode=require` | Requerido si `PERSISTENCE_DRIVER=postgres`; debe ser el endpoint **pooled** |
| `DIRECT_URL` | Solo para `prisma migrate` (nunca la app en runtime) | **Sí** | Neon → Railway/CI de migración | `postgresql://***:***@ep-***.***.neon.tech/neondb?sslmode=require` | Sin validación runtime — solo la usa el comando de migración |
| `ENGINE_DRIVER` | Sí | No | Railway (fijo) | `mock` (hoy; `http` cuando exista el motor de correo real) | `Joi.valid('mock','http')` |
| `ENGINE_BASE_URL` | Solo si `ENGINE_DRIVER=http` | No | Railway | `https://engine.***.internal` | `Joi.uri().required()` condicional |
| `ENGINE_API_KEY` | Solo si `ENGINE_DRIVER=http` | **Sí** | Railway | `***` | Opcional hoy — no forzado a `.required()` en el schema actual |
| `MAIL_ENGINE_MODE` | Sí | No | Railway (fijo) | `simulation` (**nunca `remote` todavía** — el adaptador remoto es un stub) | `Joi.valid('simulation','remote')` |
| `MAILBOX_MOTOR_DRIVER` | Sí | No | Railway (fijo) | `http` (una vez exista el motor real; `simulated` mientras tanto) | `Joi.valid('simulated','http')` |
| `MAILBOX_MOTOR_BASE_URL` | Solo si `MAILBOX_MOTOR_DRIVER=http` | No | Railway | `https://motor.***.internal` | `Joi.uri().required()` condicional |
| `MAILBOX_MOTOR_API_KEY` | Solo si `MAILBOX_MOTOR_DRIVER=http` | **Sí** | Railway | `***` | `Joi.min(1).required()` condicional |
| `MAILBOX_MOTOR_TIMEOUT_MS` | No (default 10000) | No | Railway | `10000` | `Joi.number()` |
| `SEQUENCE_MOTOR_MODE` | Sí | No | Railway (fijo) | `http` (una vez exista el motor real) | `Joi.valid('simulated','http')` |
| `SEQUENCE_MOTOR_BASE_URL` | Solo si `SEQUENCE_MOTOR_MODE=http` | No | Railway | `https://sequence-motor.***.internal` | `Joi.uri().required()` condicional |
| `SEQUENCE_MOTOR_API_KEY` | Solo si `SEQUENCE_MOTOR_MODE=http` | **Sí** | Railway | `***` | `Joi.min(1).required()` condicional |
| `SEQUENCE_MOTOR_TIMEOUT_MS` | No (default 10000) | No | Railway | `10000` | `Joi.number()` |
| `MOTOR_EVENT_AUTH_MODE` | No (default `hmac`) | No | Railway | `hmac` | `Joi.valid('hmac')` |
| `MOTOR_EVENT_HMAC_SECRET` | Sí, para que `POST /integration/events` exista | **Sí** | Railway | `***` | Vacío → el endpoint responde 404 en todo ambiente (fail-closed, nunca solo producción) |
| `MOTOR_EVENT_MAX_CLOCK_SKEW_SECONDS` | No (default 300) | No | Railway | `300` | `Joi.number()` |
| `SIGNATURE_ASSET_STORAGE_MODE` | Sí | No | Railway (fijo) | `r2` | `Joi.valid('simulated','r2')` |
| `R2_ACCOUNT_ID` | Solo si `SIGNATURE_ASSET_STORAGE_MODE=r2` | No (identificador de cuenta, no secreto) | Cloudflare → Railway | `***` | `Joi.min(1).required()` condicional |
| `R2_ACCESS_KEY_ID` | Solo si `SIGNATURE_ASSET_STORAGE_MODE=r2` | **Sí** | Cloudflare → Railway | `***` | `Joi.min(1).required()` condicional |
| `R2_SECRET_ACCESS_KEY` | Solo si `SIGNATURE_ASSET_STORAGE_MODE=r2` | **Sí** | Cloudflare → Railway | `***` | `Joi.min(1).required()` condicional |
| `R2_BUCKET_NAME` | Solo si `SIGNATURE_ASSET_STORAGE_MODE=r2` | No | Railway | `mr-outreach-production-assets` | `Joi.min(1).required()` condicional |
| `R2_PUBLIC_BASE_URL` | Sí (todo modo) | No | Railway | `https://assets.***.cl` | Debe ser HTTPS y **nunca** un dominio `*.r2.dev` en modo `r2` (validado explícitamente) |
| `R2_SIGNATURE_PREFIX` | No (default `signatures`) | No | Railway | `signatures` | Patrón de segmento de ruta seguro (sin `..`, sin espacios) |
| — `R2_ENDPOINT` | **No existe como variable** | — | — | — | El endpoint se deriva de `R2_ACCOUNT_ID` (`https://<account>.r2.cloudflarestorage.com`) — no inventar esta variable |
| — `R2_REGION` | **No existe como variable** | — | — | — | Hardcodeado a `"auto"` en el adaptador — no inventar esta variable |
| `AUTH_SECRET` | Sí | **Sí** | Railway | `***` (mínimo 16 caracteres) | `Joi.min(16).required()` |
| `CREDENTIALS_ENCRYPTION_KEY` | Sí | **Sí** | Railway | `***` (base64, exactamente 32 bytes decodificados — AES-256) | Validado en longitud exacta al arrancar |
| `API_PUBLIC_URL` | No (opcional — solo afecta URLs de `/uploads/...`) | No | Railway | `https://api.***.com` | `Joi.uri()` |
| `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` | **No en production** | `DEV_ADMIN_PASSWORD` sí sería secreto si se usara | — | — | Solo obligatorias cuando `PERSISTENCE_DRIVER=memory` — **nunca debe usarse memory en production**; omitir ambas variables en Railway |
| `DEV_EXECUTIVE_EMAIL` / `DEV_EXECUTIVE_PASSWORD` | **No en production** | Igual que arriba | — | — | Igual que arriba — omitir en Railway |

## Servicio Web (`apps/web`)

| Variable | Obligatoria | Secreto | Origen | Ejemplo enmascarado | Validación runtime |
|---|---|---|---|---|---|
| `NODE_ENV` | Sí | No | Railway (fijo) | `production` | Determina `secure: true` en la cookie de sesión (`app/api/auth/login/route.ts`) |
| `API_INTERNAL_URL` | Recomendada (evita depender de la pública para el tráfico servidor→servidor) | No | Railway (URL interna del servicio API dentro de la misma red) | `http://api.railway.internal:3001` | Usada primero por `getApiUrl()`; si falta, cae a `NEXT_PUBLIC_API_URL`, y si también falta, a `http://localhost:3001` — **verificar que no llegue a producción con ese último fallback** |
| `NEXT_PUBLIC_API_URL` | Sí (si no hay `API_INTERNAL_URL`) | No — es pública por diseño (`NEXT_PUBLIC_*` se incrusta en el bundle del navegador) | Railway | `https://api.***.com` | Ninguna — Next.js la expone tal cual al cliente |

**No existe** ninguna variable de sesión/cookie-secret propia del frontend
— la cookie httpOnly guarda el JWT que ya emite la API verbatim; no hay
nada adicional que firmar o cifrar del lado de Next.js.

### Advertencia confirmada: `${{<api-service>.PORT}}` puede resolver vacío

Detectado en `staging` (2026-07-31): `API_INTERNAL_URL` estaba configurada
como `http://${{mr-outreach-api.RAILWAY_PRIVATE_DOMAIN}}:${{mr-outreach-api.PORT}}`,
una referencia de variable entre servicios de Railway. En la práctica esa
referencia resolvió con el puerto **vacío** —
`http://mr-outreach-api.railway.internal:` (dos puntos finales, sin
número) — porque `PORT` es inyectado dinámicamente por Railway al proceso
de `mr-outreach-api` y no estaba declarado como variable explícita en la
pestaña "Variables" de ese servicio; sin una variable explícita que
referenciar, `${{mr-outreach-api.PORT}}` no tiene nada que resolver.

Síntoma en el consumidor (`mr-outreach-web`): cualquier `fetch()` server-side
hacia `API_INTERNAL_URL` (por ejemplo `getCurrentUser()` en
`apps/web/lib/session.ts`, o el proxy de login en
`apps/web/app/api/auth/login/route.ts`) falla con `fetch failed`, sin
ningún otro mensaje — y como el login colapsa cualquier error en el mismo
mensaje genérico ("Correo o contraseña incorrectos"), el síntoma visible
para el usuario final es indistinguible de una contraseña incorrecta.

**Corrección aplicada**: agregar una variable explícita `PORT=8080` en el
servicio `mr-outreach-api` (mismo puerto que ya se ve consistentemente en
sus logs de arranque: `API listening on port 8080`), para que la
referencia `${{mr-outreach-api.PORT}}` desde `mr-outreach-web` tenga un
valor real que resolver. Alternativa más simple si esto se repite: fijar
el puerto literal en `API_INTERNAL_URL`
(`http://${{mr-outreach-api.RAILWAY_PRIVATE_DOMAIN}}:8080`) en vez de
depender de la referencia cruzada a `PORT`.

**Aplica también a `production`**: al configurar `API_INTERNAL_URL` en el
ambiente `production` de Railway, verificar este mismo punto desde el
principio (confirmar que `PORT` esté declarado explícitamente en el
servicio API, o usar el puerto literal) — no asumir que la referencia
`${{...PORT}}` funciona solo porque el servicio arranca y responde bien a
tráfico público.

## Confirmaciones explícitas de higiene de secretos

- Ningún secreto real vive en `NEXT_PUBLIC_*` — la única variable pública
  (`NEXT_PUBLIC_API_URL`) es una URL, nunca una credencial.
- Ningún secreto real vive en el repositorio — todos los `.env.*.example`
  usan `replace_with_a_secure_value` o quedan vacíos.
- Ningún secreto debe grabarse en logs — confirmado que
  `MotorEventAuthGuard` nunca ecoa el `failureReason` de una firma
  inválida en la respuesta ni en logs; los adaptadores HTTP existentes no
  imprimen sus API keys.
- Ninguna imagen Docker se construye con secretos horneados — este
  proyecto no tiene un `Dockerfile` propio con `ARG`/`ENV` de secretos
  (Railway inyecta variables en runtime, no en build time, para este
  stack Node/Nest/Next estándar).

## Qué NO se hizo en esta fase

- No se creó ni configuró ningún servicio en Railway.
- No se generó ningún valor real de `AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`,
  `MOTOR_EVENT_HMAC_SECRET` ni credenciales R2.
- No se conectó este inventario a ninguna variable real de producción.
