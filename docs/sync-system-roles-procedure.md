# Procedimiento: sincronizar los roles del sistema (ADMIN/EXECUTIVE) en staging

Corrige el hallazgo de "Crear ejecutivo": `staging` solo tenía el rol
`ADMIN` configurado, así que no existía ningún `EXECUTIVE` que asignar al
crear un ejecutivo de prueba. `prisma/sync-system-roles.ts` cierra esa
brecha de forma segura e idempotente, sin usar `prisma/seed.ts` (script de
desarrollo, no idempotente, crea usuarios demo y una organización nueva, y
se niega a correr con `NODE_ENV=production`).

## Qué hace y qué NO hace

Hace, para una organización que **ya debe existir** (nunca la crea):

- Sincroniza `PERMISSION_CATALOG` completo hacia la tabla `permissions`.
- Garantiza que exista el rol `ADMIN`, con el catálogo completo asignado.
- Garantiza que exista el rol `EXECUTIVE`, con `EXECUTIVE_PERMISSION_KEYS`
  asignado.
- Es aditivo únicamente: si un rol ya tiene permisos de más (no es el
  caso hoy, pero por diseño), no los quita.

No hace, nunca:

- Crear una organización (bloquea si el nombre no existe).
- Crear usuarios, de prueba o de cualquier tipo.
- Tocar cualquier otro rol (personalizado) de la organización.
- Modificar otra organización distinta de la indicada explícitamente.
- Mostrar ninguna credencial (no maneja contraseñas en absoluto).
- Ejecutarse contra `production` bajo ninguna combinación de variables.

## 1. `--check` (solo lectura, seguro en cualquier momento)

```bash
SYNC_ROLES_TARGET=staging \
SYNC_ROLES_DATABASE_BRANCH=staging \
SYNC_ROLES_ORGANIZATION_NAME=MejoReferido \
npm run prisma:sync-system-roles -- --check
```

Al final verás `Projected result: CREATE | RECONCILE | NO_CHANGES | BLOCKED`,
con el mismo significado que en `bootstrap-admin-procedure.md` §5, aplicado
a los dos roles del sistema en vez de a un usuario.

Antes de `--apply`, repite la misma verificación manual de
`docs/bootstrap-admin-procedure.md` §5.1 (branch Railway activo, `DATABASE_URL`/
`DIRECT_URL` apuntan a Neon `staging`, nunca `production`/`development`/`test`).

## 2. `--apply` (requiere confirmación explícita)

```bash
SYNC_ROLES_TARGET=staging \
SYNC_ROLES_DATABASE_BRANCH=staging \
SYNC_ROLES_CONFIRM=SYNC_SYSTEM_ROLES_IN_STAGING \
SYNC_ROLES_ORGANIZATION_NAME=MejoReferido \
npm run prisma:sync-system-roles -- --apply
```

Corre dentro de una única transacción con su propio advisory lock (distinto
del de `bootstrap-admin.ts`, para que ninguno bloquee al otro). Es seguro
volver a ejecutarlo — un segundo `--apply` converge a `NO_CHANGES`.

## 3. Verificación posterior

Con el token de un ADMIN autenticado:

```bash
curl -s -H "Authorization: Bearer <token>" https://<api>/roles
```

(o el método equivalente de solo lectura ya usado en este proyecto, dado
que ninguno de los dos contenedores de Railway tiene `curl` — usar
`fetch` desde Node, igual que en `docs/staging-post-connection-verification.md`).

Confirma que la respuesta incluye como mínimo un objeto con `name: "ADMIN"`
y otro con `name: "EXECUTIVE"`.

## 4. Producción

Este script se niega incondicionalmente a correr con
`SYNC_ROLES_TARGET=production` (lanza error antes de tocar nada, sin
importar el valor de `SYNC_ROLES_CONFIRM`). Sincronizar roles en
`production` requiere un procedimiento independiente y explícito, no
cubierto por este documento.
