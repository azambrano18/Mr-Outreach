# Procedimiento: branch Neon `staging` — creación y conexión con Railway

Este documento es para quien tenga acceso al panel de Neon y a Railway — yo
no tengo acceso directo a ninguno de los dos desde este entorno.

## Estado actual (confirmado por el propietario del proyecto)

- **Neon `staging`: ✅ creada.**
- **Parent branch usado para crearla: pendiente de confirmación.** No
  afirmo que fue `production` ni ninguna otra opción — no me lo has
  confirmado todavía (ver "Qué confirmar sobre la creación ya hecha").
- **Modalidad de contenido usada (Current data / Schema-only / branch
  limpio): pendiente de confirmación**, por la misma razón.
- **Conexión de Railway `staging` → Neon `staging`: ✅ configurada.** El
  propietario del proyecto ya sustituyó manualmente `DATABASE_URL` y
  `DIRECT_URL` de `mr-outreach-api` (ambiente Railway `staging`) por las
  cadenas del branch Neon `staging`. **No vuelvo a pedir este cambio ni a
  tratarlo como pendiente.** Confirmado por el propietario; no verificado
  de forma independiente por mí, porque no tengo acceso a Railway.
- **Deployment posterior al cambio de variables: pendiente de
  verificación.** No confirmado si Railway redesplegó automáticamente ni
  si terminó bien — ver `docs/staging-post-connection-verification.md`.
- **Migraciones en Neon `staging`: pendientes de verificación.** No se
  afirma que estén aplicadas hasta confirmarlo por logs o inspección
  directa — ver `docs/staging-post-connection-verification.md`.
- **Inspección de la base (conteos, fixtures): pendiente.**
- **`bootstrap-admin --check`: pendiente** (se ejecuta manualmente, no
  desde este entorno).
- **`bootstrap-admin --apply`: pendiente de aprobación explícita.**
- **Administrador inicial en `staging`: pendiente.**
- **Prueba funcional real contra `staging`: pendiente.**

Todo lo pendiente de arriba requiere una verificación manual — no la
ejecuto yo, no tengo acceso ni a Neon ni a Railway. El procedimiento
detallado paso a paso para esa verificación está en
`docs/staging-post-connection-verification.md`; este documento se limita
a la creación del branch y la conexión (ya resueltas) y a la referencia de
qué se eligió al crearlo.

## Qué confirmar sobre la creación ya hecha

Sigue pendiente que confirmes, mirando el panel de Neon (no requiere
volver a tocar nada, solo mirar):

1. Parent branch mostrado por Neon para `staging` (`production`,
   `development`, `test`, u otro).
2. Modalidad de contenido usada al crearlo (Current data / Schema-only),
   si el panel de Neon la muestra en el historial del branch.
3. Que el branch `staging` no contiene ninguna fila de datos inesperada
   (ver el procedimiento de conteo en `docs/staging-post-connection-verification.md`
   §6) — si muestra datos, avísame antes de continuar con el bootstrap,
   porque cambia el análisis de riesgo.
4. Que `production`, `development` y `test` siguen exactamente igual que
   antes (mismo número de branches, ninguno renombrado ni con datos
   distintos).

Puedes compartirme estos 4 puntos sin las connection strings.

### Si `staging` resultó tener datos (parent distinto de un branch vacío)

- No uses ese branch para `bootstrap-admin.ts --apply` ni ninguna prueba
  funcional hasta que decidamos juntos si los datos son aceptables ahí o
  si conviene recrear el branch desde un origen más limpio.
- Avísame qué encontraste — cambia el análisis de riesgo de esta fase.

### Si `staging` se creó vacía (sin filas)

No hace falta ningún script de limpieza — no hay nada que limpiar (ver
"No se necesita limpieza inicial" al final).

## Referencia: las dos decisiones que ya se tomaron al crear el branch

Queda como referencia para interpretar lo que confirmes arriba.

### Decisión A — branch padre

- **`production`** — la opción que yo habría recomendado, condicionada a
  que estuviera confirmado (nunca lo estuvo de forma verificada por mí)
  que está vacía. Ver `docs/database-architecture.md` §2.
- **`development`** — si fue el parent con "Current data", revisar con
  cuidado: `development` ya tuvo contaminación de datos real (limpiada
  solo parcialmente — ver `docs/production-blockers.md`).
- **`test`** — si fue el parent, revisar igual: es fixtures efímeros de
  la suite automatizada, no pensado como base de staging.

### Decisión B — modalidad de contenido copiado

- **Current data** — copia esquema + filas del padre. Inofensiva solo si
  el padre estaba vacío.
- **Schema-only** (si el plan de Neon la ofrece) — copia solo estructura.
- Branch limpio + migrar desde cero — equivalente a Schema-only.

## Contexto de por qué se creó este branch

Railway `staging` apuntaba antes a Neon `development`. Este branch
`staging` dedicado existe para que Railway `staging` ya no dependa de
`development` — ver `docs/database-architecture.md` §2 para la
correspondencia Railway ↔ Neon, ya vigente.

## Próximo paso

Ver `docs/staging-post-connection-verification.md` para el procedimiento
completo de verificación (deployment, Pre-Deploy Command, migraciones,
API, inspección de datos) antes de ejecutar `bootstrap-admin --check`, y
`docs/bootstrap-admin-procedure.md` para el bootstrap en sí.

## No se necesita limpieza inicial en un `staging` que nació vacío

Si al confirmar el estado resulta que `staging` no tiene filas, **no hace
falta ejecutar ningún script de limpieza** — no hay nada que limpiar. Un
futuro script de limpieza de `staging` (patrón
`CLEANUP_TARGET`/`CLEANUP_DATABASE_BRANCH`/`CLEANUP_CONFIRM` descrito en
`docs/database-architecture.md` §4) solo sería necesario más adelante, y
únicamente si:

- se insertan fixtures accidentalmente durante pruebas manuales en
  `staging`;
- se reutiliza un branch `staging` ya contaminado;
- se necesita retirar datos dejados por una prueba anterior en `staging`.

Ese script no existe todavía y no se construye en esta etapa. No limpies
`development` ni `test` — no forman parte de esta tarea.

## Qué NO hace este procedimiento

- No verifica el estado de `staging`/`production` por mí — esa
  verificación manual es responsabilidad de quien tenga acceso al panel
  de Neon.
- No crea el administrador (`bootstrap-admin.ts --apply`) — paso
  posterior, separado (ver `docs/bootstrap-admin-procedure.md`).
- No limpia ninguna tabla ni ejecuta pruebas destructivas.
- No modifica `production`, `development` ni `test`.
- No hace commit, push ni merge.
