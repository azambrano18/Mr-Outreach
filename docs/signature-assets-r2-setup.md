# Cloudflare R2 — almacenamiento de imágenes (firmas y cuerpo de correo)

Fase Firma implementó la carga de imágenes en la firma de una cuenta de correo. Fase 2 (R2)
reestructura esa implementación (nueva convención de object keys, basada en el correo de la
cuenta) y agrega el segundo tipo de imagen previsto desde el inicio: las insertadas en el
**cuerpo HTML** de un Envío de Plantilla. Este documento reemplaza y actualiza la versión anterior
de este archivo — si buscas el plan de la "Fase 2" que solo documentaba lo pendiente, ese
documento (`docs/email-body-images-r2-phase2-plan.md`) fue retirado: todo lo que describía ya
está implementado y se documenta aquí.

Mr Outreach **nunca crea recursos de Cloudflare automáticamente**. Los pasos de configuración
externa (bucket, credenciales, dominio) los ejecuta una sola vez un administrador de la cuenta de
Cloudflare, antes de configurar `SIGNATURE_ASSET_STORAGE_MODE=r2`.

## 1. Arquitectura

Un único puerto (`SignatureAssetStoragePort`, el nombre se conserva por continuidad histórica
desde Fase Firma) y sus dos adaptadores (`R2SignatureAssetStorageAdapter` para producción/staging,
`SimulatedSignatureAssetStorageAdapter` para desarrollo/test) sirven **ambos** tipos de imagen —
el puerto es deliberadamente ignorante de si está guardando una imagen de firma o de cuerpo: solo
recibe un `objectKey` ya construido y validado por quien lo llama.

| Capa | Firma | Cuerpo |
|---|---|---|
| Servicio de aplicación | `SignatureAssetsService` | `EmailBodyAssetsService` |
| Tabla de metadatos | `signature_assets` (`SignatureAsset`) | `email_body_assets` (`EmailBodyAsset`) |
| Prefijo de objeto | `firmas/{correo-normalizado}/{assetId}.{ext}` | `email-body/{organizationId}/{ownerUserId}/{assetId}.{ext}` |
| Quién la edita | Un administrador o el ejecutivo dueño de la cuenta, desde la pantalla de firma de esa cuenta (`/dashboard/mailboxes/mine/:id/signature` o el equivalente admin) | El ejecutivo dueño de la Plantilla, desde el editor de cada Envío |
| Dónde se referencia | El HTML congelado de cada `SignatureVersion` y de cada `SequenceTemplateVersion.signatureHtml` | El `bodyHtml` de cada `SequenceTemplateStep` y de cada snapshot de `SequenceTemplateVersion.steps[]` |
| Se elimina cuando | Se elimina definitivamente la cuenta de correo (purga completa del prefijo) | Solo por eliminación explícita de un asset sin referencias (nunca automático) |

## 2. La firma pertenece a la cuenta de correo, no a la Plantilla

Antes de Fase 2, cada Plantilla tenía su propio borrador de firma independiente
(`SequenceTemplate.signatureHtml`, editable desde el propio editor de Plantilla). Fase 2 revierte
eso: **una cuenta de correo tiene una única firma vigente** (`Signature`/`SignatureVersion`, con
historial de versiones), compartida por todas sus Plantillas.

- `SequenceTemplatesService.getDetail()` y las rutas de publicación
  (`PublishSequenceTemplateUseCase`, `UpdateSequenceTemplateUseCase`) ya no leen
  `SequenceTemplate.signatureHtml` como fuente de verdad — siempre resuelven en vivo la firma
  actual de la cuenta (`getSignatureHtmlForMailbox`) y la congelan en el momento de publicar.
- La columna `SequenceTemplate.signatureHtml` sigue existiendo en la base de datos (se escribe una
  vez al crear la Plantilla, como snapshot inicial) pero es vestigial: ningún camino de lectura la
  usa después de la creación. No se eliminó de la base para no forzar una migración de esquema
  arriesgada; simplemente dejó de leerse.
- El editor de Plantilla ahora solo muestra una vista previa de solo lectura de la firma, con un
  enlace a la pantalla de la cuenta donde sí se edita.
- Publicar una Plantilla sigue congelando la firma vigente en ese instante dentro de
  `SequenceTemplateVersion.signatureHtml` — una Gestión ya iniciada conserva la firma de su propia
  versión aunque la cuenta cambie su firma después.

## 3. Normalización del correo (§5)

Función única y reutilizable:
`apps/api/src/domain/signature-asset/normalize-mailbox-email-for-storage.ts`.

```ts
normalizeMailboxEmailForStorageKey(mailbox.email)
```

Reglas aplicadas, en este orden:

1. `trim()` + `toLowerCase()`.
2. Debe tener un formato de correo válido (sin `@`/espacios repetidos, con un dominio).
3. Rechaza `/` y `\`.
4. Rechaza la secuencia `..`.
5. Rechaza caracteres de control.

El correo **siempre** se obtiene de `mailbox.email` en la base de datos — nunca de un valor
enviado por el cliente. El resultado normalizado es la única "carpeta" lógica de la cuenta:
`firmas/{correo-normalizado}/`. El correo queda visible en la ruta pública del asset (decisión
funcional aceptada explícitamente para esta implementación).

## 4. Bucket y prefijos

```env
R2_BUCKET_NAME=mr-outreach-assets
R2_SIGNATURE_PREFIX=firmas
R2_EMAIL_BODY_PREFIX=email-body
```

Debe existir un bucket **distinto por ambiente** (nunca el mismo bucket para staging y
production). `R2_SIGNATURE_PREFIX`/`R2_EMAIL_BODY_PREFIX` son segmentos de ruta seguros dentro del
mismo bucket — no admiten `/` al inicio/final, espacios ni `..` (validado en `env.validation.ts`).

## 5. Variables de entorno

```env
SIGNATURE_ASSET_STORAGE_MODE=r2
R2_ACCOUNT_ID=<account id de Cloudflare>
R2_ACCESS_KEY_ID=<access key del token limitado al bucket>
R2_SECRET_ACCESS_KEY=<secret key del token limitado al bucket>
R2_BUCKET_NAME=mr-outreach-assets
R2_PUBLIC_BASE_URL=https://assets.mejoreferido.com
R2_SIGNATURE_PREFIX=firmas
R2_EMAIL_BODY_PREFIX=email-body
```

Cuando `SIGNATURE_ASSET_STORAGE_MODE=r2`: `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/
`R2_BUCKET_NAME` son obligatorias, `R2_PUBLIC_BASE_URL` debe ser HTTPS y nunca `r2.dev`.

Cuando `SIGNATURE_ASSET_STORAGE_MODE=simulated` (por defecto, desarrollo/test): ninguna variable
`R2_*` es obligatoria, no se construye ningún cliente S3 y no se realiza ninguna solicitud a
Cloudflare — las imágenes se escriben en `apps/api/uploads/{objectKey}` (bajo `firmas/...` o
`email-body/...` según corresponda) y se sirven vía el mismo mount estático `/uploads/*`.

Las credenciales se leen únicamente en el backend (`AppConfigService`). Nunca llegan al frontend,
al HTML, a PostgreSQL, a la auditoría ni a los logs.

## 6. Estructura de objetos

```
firmas/{correo-normalizado}/{assetId}.{ext}
email-body/{organizationId}/{ownerUserId}/{assetId}.{ext}
```

Ejemplos:

```
firmas/ventas@empresa.cl/9e755f20-6ee4-4dc6-a1ad-21840a979ea0.png
email-body/org_123/user_456/f2d073be-43cb-4b43-a07b-cd365eb578c9.png
```

`assetId` es un UUID generado en el backend — nunca el nombre original del archivo, nunca
reutilizado entre cargas. Reemplazar una imagen siempre crea un objeto nuevo; el anterior no se
sobrescribe ni se borra automáticamente.

## 7. Adaptador real (R2SignatureAssetStorageAdapter)

Usa `@aws-sdk/client-s3` contra el endpoint S3-compatible de R2
(`https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `region: "auto"`), construido de forma
perezosa (nunca en modo `simulated`). Operaciones:

- `uploadImage` — `PutObjectCommand` con `CacheControl: public, max-age=31536000, immutable`
  (inmutable, ya que cada carga usa un `assetId` nuevo). El `objectKey` llega ya construido por el
  servicio llamante — el adaptador nunca sabe si es una firma o una imagen de cuerpo.
- `validateAssetExistence` — `HeadObjectCommand`; distingue `exists:false` (404/NoSuchKey) de un
  fallo real de acceso o de red.
- `deleteUnreferencedImage` — `DeleteObjectCommand` de un único objeto; idempotente (un objeto ya
  inexistente es éxito, no error).
- `deleteObjectsByPrefix` — **nuevo en Fase 2** (§8/§20-22 del pedido original). Lista todo el
  contenido del prefijo con `ListObjectsV2Command`, siguiendo `NextContinuationToken` hasta
  agotarlo (soporta más de 1.000 objetos), y elimina en lotes de máximo 1.000 claves por llamada
  con `DeleteObjectsCommand` (el límite duro de la API de S3/R2). Un prefijo sin objetos es un
  éxito con `deletedCount: 0`, nunca un error. Usado exclusivamente por la eliminación de cuentas
  de correo (§9) — nunca para un solo asset.

Ningún error crudo del SDK llega nunca al llamante: `toSanitizedError` normaliza cualquier
excepción a uno de los errores de dominio (`SignatureAssetUploadFailed`,
`SignatureAssetStorageUnavailable`, `SignatureAssetAccessDenied`), sin credenciales, headers ni
stack traces.

## 8. Validaciones de archivo

| | Firma | Cuerpo |
|---|---|---|
| Formatos aceptados | PNG, JPG, GIF | PNG, JPG, GIF |
| Rechazados | WebP, SVG, cualquier archivo cuyo contenido no coincida con la extensión | igual |
| Tamaño máximo | 1 MB | 3 MB |
| Dimensiones máximas | 1200×500 px | 2400×2400 px |
| Validación | Magic bytes reales (`sniffImageType`) + dimensiones reales (`getImageDimensions`) — nunca el nombre de archivo ni el `Content-Type` declarado por el navegador | igual |

## 9. Sanitización del HTML (§15)

`HtmlSanitizerService.sanitizeSignatureHtml(html, allowedImageHost, allowInsecureHost)` es el
único método que aplica la restricción de host a un `<img src>` — y ahora se usa para **ambos**
tipos de contenido:

- La firma de una cuenta (`SignaturesService.buildContent`, `UpdateMailboxConfigurationUseCase`
  para el flujo legado de configuración manual).
- El `bodyHtml` de un Envío (`SequenceTemplatesService.updateStep`) — antes usaba el método
  genérico sin restricción de host; esa era la brecha real que este documento (en su versión
  anterior, como plan) señalaba.

Solo sobrevive un `<img src>` que apunte exactamente al host configurado en `R2_PUBLIC_BASE_URL`
(HTTPS siempre, salvo en modo `simulated` sobre `localhost`). Cualquier otro host, `data:`,
`blob:`, `javascript:` o atributo de evento (`onerror`, `onclick`, etc.) es eliminado, nunca
reescrito.

## 10. Firma única por cuenta — comportamiento

- Reemplazar la imagen de una firma crea un `assetId` nuevo dentro de la misma carpeta
  (`firmas/{correo}/`) — el objeto anterior se conserva mientras la cuenta exista.
- Eliminar una Plantilla, archivarla o desvincular la cuenta **nunca** toca `firmas/{correo}/` —
  la firma y sus imágenes son independientes del ciclo de vida de cualquier Plantilla o del estado
  de vinculación de la cuenta.
- Solo la eliminación **definitiva** de la cuenta de correo (una vez ya desvinculada) purga la
  carpeta completa.

## 11. Eliminación definitiva de una cuenta — cascada a R2 (§19-22)

`DeleteMailboxUseCase` (invocado por `DELETE /mailboxes/:id`, solo cuando `linkStatus === REVOKED`):

1. Dentro de la misma transacción que el soft-delete de la cuenta: marca
   `assetCleanupStatus: PENDING`.
2. Después de confirmar la transacción (patrón idéntico al de la confirmación del motor en
   `UnlinkMailboxUseCase`): normaliza el correo, construye `firmas/{correo}/` y llama
   `deleteObjectsByPrefix`.
3. Éxito → `assetCleanupStatus: COMPLETED`, audita `mailbox.asset_cleanup_completed` con la
   cantidad de objetos eliminados.
4. Fallo (red, R2 caído, credenciales inválidas) → `assetCleanupStatus: FAILED`,
   `assetCleanupAttempts` se incrementa, `lastAssetCleanupError` guarda el mensaje sanitizado,
   audita `mailbox.asset_cleanup_failed`. **La eliminación de la cuenta ya se confirmó** — un
   fallo de R2 nunca revierte ni bloquea la eliminación de la cuenta en Mr Outreach, solo dificulta
   la limpieza física en R2, que queda pendiente de reintento.
5. `POST /mailboxes/:id/retry-asset-cleanup` (permiso `mailboxes.delete`) reintenta manualmente una
   limpieza en `FAILED`. Idempotente: reintentar una limpieza ya `COMPLETED` responde éxito sin
   volver a ejecutar nada.

El estado (`assetCleanupStatus`/`assetCleanupAttempts`/`lastAssetCleanupError`) está **persistido**
en la tabla `mailboxes` — sobrevive un reinicio del proceso, a diferencia de un reintento solo en
memoria.

**Imágenes del cuerpo (`email-body/`) nunca se ven afectadas** por la eliminación de una cuenta de
correo — pertenecen al ejecutivo/organización, no a ninguna cuenta específica.

## 12. Protección de otras carpetas (§21)

`deleteObjectsByPrefix` solo actúa sobre objetos cuya clave comienza exactamente con
`firmas/{correo-normalizado}/` (con la barra final incluida, `buildSignatureFolderPrefix` siempre
la agrega) — nunca por coincidencia parcial. `ventas@empresa.cl` y `ventas2@empresa.cl` nunca
comparten prefijo. Verificado en `apps/api/test/mailbox-link-flow.e2e-spec.ts` (una cuenta se
elimina, la carpeta de una cuenta distinta permanece intacta con un archivo real en disco en modo
`simulated`).

## 13. Consecuencia sobre correos históricos (§23)

Decisión funcional aceptada: al eliminar definitivamente una cuenta de correo, sus imágenes de
firma se eliminan de Cloudflare R2. Un correo histórico que ya referenciaba esa URL puede dejar de
mostrar la imagen. Se conservan intactos: texto, asunto, destinatarios, el resto del HTML, eventos,
comandos, auditoría y trazabilidad — solo se pierde el archivo físico de la imagen. El modal de
"Eliminar cuenta" (`server-linked-mailbox-panel.tsx`) informa esta consecuencia explícitamente
antes de confirmar.

## 14. Auditoría

Acciones registradas (`AuditLogRepository`, nunca con credenciales, binarios ni tokens):

`signature_asset.upload`, `signature_asset.delete`, `email_body_asset.upload`,
`email_body_asset.delete`, `mailbox.delete`, `mailbox.asset_cleanup_completed`,
`mailbox.asset_cleanup_failed` (con `retried: true` cuando proviene del endpoint de reintento).

## 15. Endpoints

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| POST | `/mailboxes/:mailboxId/signature-assets` | `signatures.update` | Admin — sin chequeo de asignación |
| POST | `/me/mailboxes/:mailboxId/signature-assets` | `signatures.update` | Ejecutivo — 404 si la cuenta no está asignada a él |
| DELETE | `/mailboxes/:mailboxId/signature-assets/:assetId` | `signatures.update` | Admin — rechaza si el asset sigue referenciado (§10) |
| POST | `/email-body-assets` | `sequence_templates.update_own` | Un ejecutivo solo puede subir/borrar las suyas (verificado por referencia, no por ruta) |
| DELETE | `/email-body-assets/:assetId` | `sequence_templates.update_own` | Rechaza si sigue referenciado (draft o versión publicada) |
| POST | `/mailboxes/:id/retry-asset-cleanup` | `mailboxes.delete` | Reintento manual, idempotente |
| GET/PATCH | `/mailboxes/:mailboxId/signature` y `/me/mailboxes/:mailboxId/signature` | `signatures.read`/`signatures.update` | Ya existían desde Fase Firma — ahora con UI real (`/dashboard/mailboxes/mine/:id/signature`) |

## 16. Migraciones

`prisma/migrations/20260801120000_r2_asset_storage_phase2/migration.sql` (generada con
`prisma migrate diff` a partir del esquema anterior, no escrita a mano) agrega:

- `mailboxes.assetCleanupStatus` (enum `MailboxAssetCleanupStatus`, default `NOT_NEEDED`),
  `assetCleanupAttempts` (default `0`), `lastAssetCleanupError`.
- `signature_assets.mailboxId` (nullable — las filas anteriores a esta migración no tienen uno;
  toda carga nueva siempre lo completa).
- Tabla nueva `email_body_assets` (+ enum `EmailBodyAssetStatus`, índices, foreign keys).

No se eliminó ninguna columna existente (en particular, `sequence_templates.signatureHtml` y
`signature_assets.ownerUserId` permanecen intactas, aunque la primera ya no se lee — ver §2).

### Rollback

Esta migración es aditiva (nuevas columnas nullable/con default, tabla nueva) — revertir el
código a la versión anterior sin revertir la migración es seguro (las columnas nuevas
simplemente quedarían sin usar). Para revertir también el esquema:

```sql
DROP TABLE "email_body_assets";
ALTER TABLE "signature_assets" DROP COLUMN "mailboxId";
ALTER TABLE "mailboxes" DROP COLUMN "assetCleanupStatus", DROP COLUMN "assetCleanupAttempts", DROP COLUMN "lastAssetCleanupError";
DROP TYPE "EmailBodyAssetStatus";
DROP TYPE "MailboxAssetCleanupStatus";
```

Nunca ejecutar esto contra una base con datos reales sin respaldo previo.

## 17. Troubleshooting

| Síntoma | Causa probable | Verificación |
|---|---|---|
| Sube la imagen pero la firma no la muestra | El host de `R2_PUBLIC_BASE_URL` no coincide con el que ve el sanitizador (`signatureAssetAllowedImageHost`) | Confirmar que `R2_PUBLIC_BASE_URL` es idéntico en el servicio que sanea y en el que sirve las imágenes |
| `403 Acceso denegado al almacenamiento` | Credenciales R2 inválidas o token sin permiso sobre el bucket | Revisar el R2 API Token en el dashboard de Cloudflare — debe tener Object Read & Write sobre el bucket exacto |
| Cuenta eliminada pero `assetCleanupStatus` sigue en `FAILED` | R2 no respondió durante la eliminación | `POST /mailboxes/:id/retry-asset-cleanup`; revisar `lastAssetCleanupError` en la fila de la cuenta |
| Una imagen de cuerpo desaparece de un borrador sin querer | Se eliminó el asset manualmente sin darse cuenta de que ya no está referenciado en ningún otro lado — la única protección es la comprobación de referencias, no hay papelera | Revisar auditoría `email_body_asset.delete` para confirmar quién y cuándo |

## 18. Runbook de staging (§38)

Usar exclusivamente datos de QA — nunca cuentas ni plantillas reales.

**Firma:**
1. Configurar `SIGNATURE_ASSET_STORAGE_MODE=r2` con las credenciales del bucket de staging en
   Railway (nunca las de producción).
2. Abrir `/dashboard/mailboxes/mine/{id}/signature` para una cuenta QA vinculada y asignada.
3. Cargar un PNG válido (menor a 1200×500 px, menor a 1 MB) e insertarlo con el botón de la
   barra de herramientas.
4. Guardar. Recargar la página y confirmar que la firma persiste.
5. Confirmar en el dashboard de Cloudflare (o vía `curl -I` al `publicUrl` devuelto) que el objeto
   quedó bajo `firmas/{correo-normalizado-de-la-cuenta}/`.
6. Reemplazar la imagen — confirmar que se genera un `assetId` nuevo y el objeto anterior sigue
   existiendo en el bucket.
7. Intentar subir un SVG y un WebP — confirmar rechazo (`400`).
8. Intentar subir un archivo renombrado como `.png` sin serlo — confirmar rechazo.

**Cuerpo:**
9. Abrir una Plantilla QA, insertar una imagen en el cuerpo de un Envío.
10. Confirmar que la URL pública contiene `email-body/`, nunca `firmas/`.
11. Guardar el borrador, recargar, confirmar que persiste.
12. Publicar la Plantilla; confirmar que la vista previa sigue mostrando la imagen.

**Conservación:**
13. Archivar (o eliminar) la Plantilla QA usada arriba — confirmar en el dashboard de Cloudflare
    que la carpeta `firmas/{correo}/` de la cuenta sigue existiendo.
14. Desvincular la cuenta QA — confirmar que la carpeta de firma sigue existiendo.

**Eliminación:**
15. Eliminar definitivamente la cuenta QA (ya desvinculada).
16. Confirmar en Cloudflare que todos los objetos bajo `firmas/{correo}/` fueron eliminados.
17. Confirmar que las imágenes de `email-body/` de esa organización siguen existiendo.
18. Confirmar en `GET /mailboxes/:id/audit-log` (por id, antes de que deje de ser accesible por
    otras rutas) las entradas `mailbox.delete` y `mailbox.asset_cleanup_completed`.
19. Si `assetCleanupStatus` quedó en `FAILED` (p. ej. simulando una caída de red), ejecutar
    `POST /mailboxes/:id/retry-asset-cleanup` y confirmar que pasa a `COMPLETED`.

**Este repositorio no ejecutó este runbook contra un bucket real de Cloudflare R2** — ver el
informe de la tarea para el estado exacto de lo verificado (automatizado, contra el adaptador
`simulated`) frente a lo que queda pendiente de tu verificación manual en staging.
