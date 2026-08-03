# Procedimiento: limpieza de datos operativos/de prueba en `staging`

Cumple lo que `docs/database-architecture.md` §4 dejaba anotado como
pendiente ("si en el futuro se necesita limpiar datos [en `staging`], el
script correspondiente debe exigir `CLEANUP_TARGET=staging` +
`CLEANUP_DATABASE_BRANCH=staging` + una confirmación explícita, y rechazar
`production`/`development`/`test`") y lo que `docs/neon-staging-branch-procedure.md`
también dejaba anotado como un futuro script no construido todavía. Ese
script es `prisma/cleanup-staging-test-data.ts`, con el mismo patrón de
nombres que sus dos hermanos (`BOOTSTRAP_*` en `bootstrap-admin.ts`,
`SYNC_ROLES_*` en `sync-system-roles.ts`), aquí `STAGING_CLEANUP_*`.

## Por qué existe

`staging` acumuló cuentas de correo, plantillas, gestiones, conversaciones,
clientes e importaciones de prueba a lo largo de las fases anteriores de
este proyecto. Antes de una prueba funcional real de punta a punta, el
objetivo es dejar la base en un estado equivalente a una organización recién
creada — solo dos cuentas de usuario, sin ningún dato operativo — sin
recrear la organización, los roles ni el catálogo de permisos desde cero.

## Qué hace y qué NO hace

Preserva siempre, sin excepción:

- La fila de `Organization` (no se recrea).
- Exactamente dos usuarios: el que indiques en
  `STAGING_CLEANUP_KEEP_ADMIN_EMAIL` (debe ya tener el rol `ADMIN`) y el que
  indiques en `STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL` (debe ya tener el rol
  `EXECUTIVE`). El script nunca crea usuarios ni asigna roles — si alguno de
  los dos no existe o no tiene el rol esperado, `--check` lo bloquea y
  reporta exactamente qué falta (por ejemplo, correr
  `prisma:sync-system-roles` primero).
- Todos los roles y permisos (`ADMIN`, `EXECUTIVE`, el catálogo completo).
- `_prisma_migrations` (nunca tocada por código de aplicación, solo por
  `prisma migrate`).
- Los `audit_logs` de la organización — se preservan deliberadamente, no se
  borran (ver el comentario de cabecera de `cleanup-staging-test-data.ts`
  para el razonamiento completo). El propio `--apply` agrega una fila nueva
  documentando qué borró.

Elimina de forma **permanente y real** (no un soft-delete, no solo "se
oculta en el frontend") todo lo demás perteneciente a esa organización:
cuentas de correo y sus pruebas de conexión, firmas e imágenes de firma
(incluyendo su carpeta `firmas/{correo}/` en R2 o en disco local),
plantillas y sus versiones publicadas, gestiones e importaciones de
prospectos, conversaciones y sus mensajes/notas/etiquetas, secuencias legacy
y sus contactos/envíos programados, clientes gestionados y dominios,
comandos/eventos de integración, variables y plantillas de correo legacy, y
cualquier otro usuario que no sea uno de los dos indicados arriba (junto con
sus asignaciones de rol).

Nunca hace, bajo ninguna combinación de variables:

- `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE` indiscriminado, ni desactivar
  constraints para esconder un error — cada borrado es un `DELETE` scopeado
  por `organizationId` (o por relación, para las 3 tablas de versión sin esa
  columna), dentro de una única transacción con un `pg_advisory_xact_lock`
  propio. Si el orden de borrado tuviera algún error, Postgres rechaza el
  `DELETE` ofensivo con una violación de llave foránea y revierte **toda**
  la transacción — nunca queda una limpieza a medias.
- Tocar `Organization`, `Role`, `Permission`, `RolePermission`, o cualquier
  fila de una organización distinta a la resuelta desde los dos correos
  indicados.
- Ejecutarse con `STAGING_CLEANUP_TARGET` distinto de exactamente
  `staging` — esto incluye `production`, que además tiene su propio rechazo
  independiente, incondicional, sin importar qué confirmaciones se hayan
  puesto (dos capas separadas).
- Ejecutarse sin `DATABASE_URL` definida y no vacía.
- Continuar en `--apply` si la organización resuelta (a partir de los dos
  correos protegidos) no coincide exactamente con
  `STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID` — el id que imprimió tu último
  `--check`.
- Mostrar ninguna credencial ni cadena de conexión.

## 0. Antes de empezar

- Confirma con `docs/staging-post-connection-verification.md` que
  `DATABASE_URL`/`DIRECT_URL` de `mr-outreach-api` en Railway `staging`
  siguen apuntando al branch Neon `staging` (nunca `production`,
  `development` ni `test`) — misma verificación manual de 8 puntos que
  `docs/bootstrap-admin-procedure.md` §5.1.
- Decide qué dos correos vas a preservar. Salvo que me digas otra cosa, se
  asume `sistema@mejoreferido.cl` (ADMIN) y tu propio correo (EXECUTIVE).

## 1. `--check` (solo lectura, obligatorio antes de `--apply`)

```bash
STAGING_CLEANUP_TARGET=staging \
STAGING_CLEANUP_DATABASE_BRANCH=staging \
STAGING_CLEANUP_KEEP_ADMIN_EMAIL=sistema@mejoreferido.cl \
STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL=azambrano@mejoreferido.cl \
npm run prisma:cleanup-staging-test-data -- --check
```

La salida muestra, en este orden:

1. Si cada correo a preservar existe y ya tiene el rol esperado.
2. La organización resuelta (nombre + id).
3. Cada otro usuario que sería eliminado (correo + id).
4. Cada cuenta de correo que sería eliminada — y cuya carpeta
   `firmas/{correo}/` sería purgada de R2 (o de `uploads/firmas/{correo}/`
   en disco, si el proceso corre en modo `simulated`).
5. La cantidad de filas a borrar, tabla por tabla, en el mismo orden en que
   `--apply` las borraría.
6. Qué queda intacto (organización, roles, permisos, migraciones, los 2
   usuarios, y cuántas filas de `audit_logs` se preservan).
7. `Projected result`: `READY` (hay algo que borrar), `NO_CHANGES` (la
   organización ya está limpia — es lo esperado en una segunda ejecución) o
   `BLOCKED` (algo impide continuar — lee la razón impresa).

Si el resultado no es el esperado, no sigas — compártemelo y lo revisamos.

**Copia el id de organización que imprime la línea "Organization in scope"**
— lo necesitas literalmente en el paso 3 (`STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID`).
Es la forma en que `--apply` verifica que de verdad corriste este `--check`
contra la misma base: no hay ninguna otra forma de que conozcas ese id.

## 2. Decisión de respaldo — obligatoria, sin valor por defecto

`--apply` exige elegir **exactamente una** de estas dos variables (nunca
ninguna, nunca ambas, ningún otro valor que no sea literalmente `true`):

**Opción A — creaste un respaldo.** En el panel de Neon: Proyecto →
**Branches** → selecciona `staging` → **Create branch** → nómbralo, por
ejemplo, `staging-backup-YYYYMMDD` → origen: el branch `staging` actual, con
**Current data**. Confirma que el nuevo branch aparece con un tamaño de
datos similar al de `staging` (no vacío) — es tu punto de restauración si
algo sale mal. Luego:

```bash
STAGING_CLEANUP_BACKUP_ACKNOWLEDGED=true
```

**Opción B — decides proceder sin respaldo.** Válido y aceptado: `staging`
es un ambiente desechable y esta decisión es tuya. No hace falta crear
ningún branch. Además del flag, `--apply` exige una frase de aceptación
completa, comparada de forma exacta:

```bash
STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP=true
STAGING_CLEANUP_NO_BACKUP_PHRASE="ACEPTO ELIMINAR DEFINITIVAMENTE LOS DATOS DE STAGING SIN RESPALDO"
```

Justo antes de borrar nada, la consola imprime:

```
Se ejecutará una eliminación permanente en Neon staging sin respaldo. Los datos no podrán recuperarse.
```

Ninguna de las dos variables tiene un valor por defecto — `--apply` rechaza
la ejecución si no defines ninguna, si defines ambas, o si el valor no es
exactamente `true` (o la frase no coincide exacta, en la Opción B).

## 3. `--apply` (requiere mi aprobación previa y el resultado de `--check` revisado)

Ejemplo usando la Opción B (sin respaldo — la que vas a usar):

```bash
STAGING_CLEANUP_TARGET=staging \
STAGING_CLEANUP_DATABASE_BRANCH=staging \
STAGING_CLEANUP_KEEP_ADMIN_EMAIL=sistema@mejoreferido.cl \
STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL=azambrano@mejoreferido.cl \
STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID=<id impreso por --check> \
STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP=true \
STAGING_CLEANUP_NO_BACKUP_PHRASE="ACEPTO ELIMINAR DEFINITIVAMENTE LOS DATOS DE STAGING SIN RESPALDO" \
STAGING_CLEANUP_CONFIRM=WIPE_TEST_DATA_IN_STAGING \
STAGING_CLEANUP_CONFIRM_PHRASE="ELIMINAR DATOS DE PRUEBA STAGING" \
npm run prisma:cleanup-staging-test-data -- --apply
```

Capas de confirmación exigidas, todas obligatorias: `STAGING_CLEANUP_CONFIRM`,
`STAGING_CLEANUP_CONFIRM_PHRASE`, la decisión de respaldo del paso 2, y
`STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID` coincidiendo con el id de tu
último `--check` — más capas que `bootstrap-admin`/`sync-system-roles`,
proporcional a que este script borra datos de forma permanente en vez de
solo crear/reconciliar filas.

La salida final muestra, tabla por tabla, cuántas filas se borraron, cuántos
usuarios se eliminaron, qué decisión de respaldo se usó, y el resultado de
la limpieza de assets (R2 o disco): cuántas carpetas `firmas/{correo}/` se
purgaron y cuáles fallaron (si alguna falla, los datos en Postgres YA
quedaron borrados correctamente — la falla es solo del lado de R2/disco, y
se reporta con el correo exacto para purgarlo manualmente desde la consola
de Cloudflare si hace falta).

## 4. Confirmar idempotencia

Vuelve a correr exactamente el mismo comando de `--check` del paso 1.
Debe reportar `Projected result: NO_CHANGES` y cero usuarios/filas a
borrar. Si vuelve a mostrar `READY`, avísame antes de tocar nada más.

## 5. Verificación funcional en la UI

Con el usuario ADMIN preservado, confirma en el dashboard:

- **Ejecutivos**: solo aparece el usuario EXECUTIVE preservado.
- **Cuentas de correo**: vacío.
- **Plantillas**: vacío.
- **Gestiones**: vacío.
- **Conversaciones**: vacío.
- **Clientes**: vacío.
- El login de ambos usuarios preservados sigue funcionando con sus
  contraseñas actuales (este script nunca las toca).

No declares la limpieza como exitosa solo por ver estas pantallas vacías —
son la confirmación visual, pero la evidencia real es la salida de
`--apply` (conteos por tabla) y el `NO_CHANGES` del paso 4.

## Producción

Este script se niega incondicionalmente a correr con
`STAGING_CLEANUP_TARGET=production` (lanza el error antes de tocar nada,
sin importar el valor de ninguna confirmación). Limpiar datos en
`production` no es un caso de uso de este script y requeriría un
procedimiento independiente, explícito, y muy probablemente nunca
justificado (production no debería acumular "datos de prueba").
