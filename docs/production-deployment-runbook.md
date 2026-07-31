# Runbook de despliegue a producción — Mr Outreach

**Documento de procedimiento. Ningún paso de este runbook ha sido
ejecutado contra `production`.** Existe para ser revisado, aprobado y
seguido cuando llegue el momento autorizado — no antes.

Release candidate de referencia: rama `release/mr-outreach-production-readiness`.
Ver `docs/test-inventory-reconciliation.md` y `docs/migrations-inventory.md`
para la evidencia que respalda "todo verde" antes de seguir este runbook.

## 1. Prerrequisitos

- Release candidate congelado (ver §Orden, paso A) y con las validaciones
  de `docs/test-inventory-reconciliation.md` en verde.
- Proyecto Neon "Mr Outreach" con su branch `production` existente, vacío
  y accesible (confirmado en fases anteriores — nunca el proyecto
  "Mejoreferido").
- Cuenta Cloudflare R2 con el bucket de producción ya creado (fuera del
  alcance de este repositorio — ver `docs/signature-assets-r2-setup.md`).
- Dominio público de la API y del frontend ya resueltos en DNS.
- Acceso administrativo a Railway para quien ejecute el despliegue.
- Este runbook, el checklist de variables
  (`docs/railway-environment-variables-inventory.md`) y el contrato del
  motor (`docs/operational-status-check-motor-handoff.md`) ya revisados
  por los responsables de §2.

## 2. Responsables

| Rol | Responsabilidad en este despliegue |
|---|---|
| Responsable de release | Congela el release candidate, autoriza el inicio |
| Responsable de infraestructura (Railway/Neon) | Ejecuta variables, migración, despliegue, backup |
| Responsable del motor (equipo externo) | Confirma `docs/operational-status-check-motor-handoff.md` antes del corte, o confirma que no bloquea este despliegue si no aplica todavía |
| Responsable de QA/smoke tests | Ejecuta y firma los smoke tests de §14 |

*(Nombres concretos a completar por la organización — este documento no
asigna personas, solo roles.)*

## 3. Ventana de despliegue

A definir por la organización. Recomendación: horario de bajo tráfico,
con los responsables de §2 disponibles durante toda la ventana y al menos
1 hora después, dado que `production` parte de una base vacía (primera
migración real contra datos de verdad, no un ajuste incremental).

## 4. Verificaciones previas

- [ ] `release/mr-outreach-production-readiness` sin cambios pendientes de fusionar.
- [ ] Las 25 suites de `docs/test-inventory-reconciliation.md` en verde contra `test` (evidencia con fecha reciente).
- [ ] `git log --oneline -1` de la rama coincide con el commit que se va a desplegar.
- [ ] `git diff --check` limpio, búsqueda de secretos limpia (ver §Confirmaciones de cada fase anterior).

## 5. Confirmación del contrato del motor

- [ ] `docs/operational-status-check-motor-handoff.md` enviado al responsable del motor.
- [ ] **Este paso puede NO estar resuelto y el despliegue puede continuar de todas formas** — `OPERATIONAL_STATUS_CHECK` no está implementado y no lo bloquea; documentar explícitamente en el runbook ejecutado que este contrato sigue pendiente, no fingir que está resuelto.

## 6. Confirmación de variables Railway

- [ ] Cada variable de `docs/railway-environment-variables-inventory.md` marcada como obligatoria está cargada en el servicio Railway correspondiente (API o Web).
- [ ] Ninguna variable `DEV_ADMIN_*`/`DEV_EXECUTIVE_*` está presente en el servicio de producción.
- [ ] `PERSISTENCE_DRIVER=postgres`, nunca `memory`, en producción.
- [ ] `NEXT_PUBLIC_API_URL` apunta al dominio público real de la API.

## 7. Confirmación de Cloudflare R2

- [ ] Bucket de producción existe y es distinto del de staging/desarrollo.
- [ ] `R2_PUBLIC_BASE_URL` es un dominio propio HTTPS, nunca `*.r2.dev`.
- [ ] Credenciales R2 de producción cargadas solo en Railway, nunca commiteadas.

## 8. Confirmación del dominio de assets

- [ ] El dominio público de firmas (`assets.mejoreferido.cl` o el que la
  organización confirme) resuelve correctamente y sirve HTTPS válido
  antes de apuntar `R2_PUBLIC_BASE_URL` ahí.

## 9. Confirmación del branch `production` en Neon

- [ ] Confirmado de solo lectura: branch `production` del proyecto **"Mr
  Outreach"** (nunca "Mejoreferido"), vacío (0 tablas o solo
  `_prisma_migrations` si ya se corrió una vez).
- [ ] `DATABASE_URL`/`DIRECT_URL` de producción documentados únicamente en
  el gestor de secretos de Railway, nunca en un archivo versionado.

## 10. Respaldo previo

- [ ] Crear un branch de respaldo en Neon a partir de `production` **antes**
  de aplicar la migración inicial (aunque `production` esté vacío, este
  paso deja el hábito instalado para el próximo despliegue, cuando ya no
  lo estará).
- [ ] Documentar el nombre del branch de respaldo y la hora exacta en la
  bitácora de este despliegue.

## 11. Comando de migración

```
prisma migrate deploy
```

ejecutado **únicamente** con `DATABASE_URL`/`DIRECT_URL` apuntando al
branch `production` de "Mr Outreach", desde un job controlado (CI/consola
administrativa), nunca desde una máquina de desarrollo con variables de
entorno mixtas. **Nunca** `prisma db push`. **Nunca** `prisma migrate reset`.

Las 4 migraciones se aplican en orden (ver `docs/migrations-inventory.md`
para el detalle y los hashes SHA-256 de verificación):

1. `20260730000000_init_mr_outreach`
2. `20260730000001_restore_case_insensitive_unique_indexes`
3. `20260731000000_persist_conversations_and_active_flow_attribution`
4. `20260731145609_motor_event_ingestion`

## 12. Orden de despliegue

Ver "Orden propuesto" al final de este documento (pasos A-S) — es la
secuencia completa, con la migración como paso D, no como un paso aislado.

## 13. Creación segura del primer administrador

**Nunca** usar `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD` (esas variables no
deben ni existir en producción). El primer usuario ADMIN de producción
debe crearse mediante un mecanismo que:
- genere una contraseña temporal aleatoria (mismo patrón que
  `POST /users` ya usa para ejecutivos — `mustChangePassword: true`), o
- se ejecute como un script one-off controlado por el responsable de
  infraestructura, con la contraseña temporal comunicada por un canal
  seguro fuera de este repositorio (nunca por email en texto plano, nunca
  en un ticket público).

Este runbook no prescribe el mecanismo exacto porque no existe todavía un
comando dedicado "crear admin inicial" fuera del flujo normal de
`POST /users` (que ya requiere estar autenticado como ADMIN) — es una
decisión operativa pendiente, marcada como bloqueador en
`docs/production-blockers.md`.

## 14. Smoke tests (pasos J-Q del orden propuesto)

Ejecutar, en orden, contra la API/frontend de producción recién
desplegados, con datos deliberadamente marcados como prueba (nunca datos
de un cliente real):

1. Vinculación por token (§J).
2. Listado local de clientes (§K).
3. Firma y Cloudflare R2 (§L).
4. Creación/publicación de una Plantilla (§M).
5. Gestión en modo controlado — sin prospectos reales (§N).
6. Evento simulado del motor, vía el simulador dev-only si
   `SEQUENCE_MOTOR_MODE=simulated` en ese momento, o un evento HMAC real
   de prueba si ya hay motor conectado (§O).
7. Conversación creada y visible (§P).
8. Estado leído/no leído independiente por usuario (§Q).

Cada uno de estos pasos debe documentarse con su resultado (éxito/fallo)
y capturas o logs, no solo "OK" verbal.

## 15. Monitoreo

Ver `docs/observability-assessment.md` — se revisa el estado actual antes
de decidir si algo mínimo se agrega antes del corte.

## 16. Criterios de rollback

Activar rollback si, dentro de la ventana de observación post-despliegue:

- el health check (`/health/live` o `/health/ready`) falla de forma
  sostenida (más de 2-3 minutos, no un blip transitorio);
- la migración falla a mitad de camino y `_prisma_migrations` queda con
  una fila sin `finished_at`;
- un smoke test crítico (vinculación por token, o creación de
  Conversación) falla de forma reproducible;
- la tasa de errores 5xx supera un umbral que el responsable de
  infraestructura defina como inaceptable para la ventana.

## 17. Procedimiento de rollback

Ver §Plan de rollback más abajo — sección dedicada, con las 4 categorías
que pidió esta fase (frontend/API/variables/migraciones) tratadas por
separado.

## 18. Criterios de éxito

- Los 8 smoke tests de §14 pasan.
- `_prisma_migrations` en producción coincide exactamente con las 4 filas
  de `docs/migrations-inventory.md`, todas `finished_at` no nulo, ninguna
  `rolled_back_at`.
- El primer administrador puede iniciar sesión y el resto del equipo
  puede ser dado de alta a partir de ahí.
- Ningún error 5xx sostenido durante la primera hora de observación.

## 19. Evidencias que deben guardarse

- Salida completa de `prisma migrate deploy` contra producción.
- Captura de `_prisma_migrations` post-migración.
- Resultado de cada smoke test de §14 (texto o captura).
- Hora exacta de cada paso del orden propuesto (A-S).
- Nombre del branch de respaldo de Neon creado en §10.

## 20. Aprobaciones requeridas

- [ ] Responsable de release.
- [ ] Responsable de infraestructura.
- [ ] Confirmación explícita de que `docs/operational-status-check-motor-handoff.md`
  fue enviado (aprobación del motor NO es bloqueante para este
  despliegue, solo para implementar la llamada real más adelante).

---

## Orden propuesto de ejecución

**Ninguno de estos pasos se ha ejecutado.** Se documentan en el orden en
que deben correr el día del despliegue autorizado.

| Paso | Acción |
|---|---|
| A | Congelar el release candidate (tag/commit fijo, sin más cambios). |
| B | Confirmar variables (§6). |
| C | Crear branch o snapshot de respaldo de `production` en Neon (§10). |
| D | Ejecutar `prisma migrate deploy` mediante un job controlado (§11). |
| E | Verificar `_prisma_migrations` (4 filas, todas `finished_at`, ninguna `rolled_back_at`). |
| F | Desplegar API. |
| G | Verificar health check (`/health/live`, `/health/ready`). |
| H | Desplegar frontend. |
| I | Crear administrador inicial mediante un mecanismo seguro (§13). |
| J | Validar vinculación por token. |
| K | Validar listado local de clientes. |
| L | Validar firma y Cloudflare R2. |
| M | Validar Plantilla. |
| N | Validar Gestión en modo controlado. |
| O | Validar evento del motor. |
| P | Validar Conversación. |
| Q | Validar leído/no leído. |
| R | Verificar auditoría (`AuditLog` registrando las acciones anteriores). |
| S | Monitorear errores durante la ventana de observación acordada. |

---

## Plan de rollback

### 1. Rollback de frontend

- Volver al deployment/imagen anterior en Railway (un clic si Railway
  conserva el deployment previo, que es su comportamiento por defecto).
- No requiere ninguna acción de base de datos.

### 2. Rollback de API

- Volver al commit/imagen anterior desplegado — el commit inmediatamente
  anterior al que introdujo el problema, identificado por su hash exacto
  en el historial de `release/mr-outreach-production-readiness` o de
  `main` una vez fusionado.
- Como las migraciones de este release son **aditivas** (confirmado en
  `docs/migrations-inventory.md` — ninguna elimina columnas ni tablas),
  la API anterior sigue funcionando contra el esquema ya migrado sin
  necesidad de revertir la migración: columnas nuevas que el código
  viejo no usa simplemente quedan sin leer, no rompen nada.

### 3. Rollback de variables

- Revertir cualquier variable Railway cambiada específicamente para este
  despliegue, a su valor anterior documentado.
- Nunca borrar `MOTOR_EVENT_HMAC_SECRET` como "solución rápida" — hacerlo
  no revierte nada, solo apaga el endpoint de eventos (fail-closed) y
  puede perder eventos entrantes reales del motor si ya está conectado.

### 4. Rollback de migraciones

- **Nunca** una migración SQL destructiva inversa como primera opción.
- Al ser aditivas, la estrategia por defecto es **corregir hacia
  adelante**: si algo del esquema nuevo tiene un defecto, se corrige con
  una migración aditiva nueva, no revirtiendo la anterior.
- Revertir una migración ya aplicada en `production` solo se considera si
  hay evidencia de corrupción de datos real, y siempre:
  - con el branch de respaldo de Neon (§10) ya creado y verificado como
    restaurable;
  - con aprobación explícita del responsable de release, nunca
    unilateral;
  - documentando exactamente qué tabla/columna se revierte y por qué.

### Definiciones del plan de rollback

| Elemento | Valor |
|---|---|
| Commit o tag anterior | El HEAD de `release/mr-outreach-production-readiness` (o de `main`, una vez fusionado) inmediatamente antes del commit desplegado — identificado por hash exacto en la bitácora de despliegue, nunca "el de ayer" |
| Imagen o deployment anterior | El deployment previo que Railway conserva por defecto para cada servicio |
| Respaldo Neon | El branch creado en el paso C del orden propuesto |
| Criterios de activación | Ver §16 |
| Responsable | El responsable de infraestructura de §2, con aprobación del responsable de release para cualquier reversión de migración |
| Tiempo máximo de decisión | 15 minutos desde que se detecta el criterio de activación — no dejar el sistema fallando mientras se delibera |
| Datos que no deben eliminarse | Ninguna fila de `IntegrationEvent`, `IntegrationCommand`, `Conversation`, `ConversationMessage`, `AuditLog` — ver siguiente punto |
| Protección de `IntegrationEvent`/`IntegrationCommand` durante rollback | Un rollback de **aplicación** (frontend/API) nunca toca estas tablas — son datos, no código. Un rollback de **migración** (el caso excepcional de la sección 4) debe excluir explícitamente estas tablas de cualquier reversión: son el registro de auditoría/trazabilidad del sistema y su pérdida elimina la capacidad de reconstruir qué pasó durante el incidente que motivó el rollback |
