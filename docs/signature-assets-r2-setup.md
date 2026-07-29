# Configuración externa de Cloudflare R2 para imágenes de firma

Fase Firma permite insertar imágenes (PNG/JPG/GIF, hasta 1200x500 px, 1 MB) dentro de la firma
de una Plantilla. En producción esas imágenes se alojan en un bucket de Cloudflare R2 servido
bajo un dominio propio — nunca en `r2.dev`, nunca en Google Drive/OneDrive/Dropbox, nunca como
`data:` base64 dentro del HTML.

Mr Outreach **nunca crea recursos de Cloudflare automáticamente**. Estos son los pasos externos
que un administrador de la cuenta de Cloudflare debe ejecutar una sola vez, antes de configurar
`SIGNATURE_ASSET_STORAGE_MODE=r2`.

## 1. Crear el bucket

1. En el dashboard de Cloudflare, ir a **R2 → Create bucket**.
2. Nombrarlo de forma que distinga el ambiente, p. ej. `mr-outreach-production-assets` /
   `mr-outreach-staging-assets` (nunca compartir el mismo bucket entre ambientes).
3. Dejarlo como bucket estándar (no "Location Hint" especial es necesario para este uso).

## 2. Crear credenciales limitadas al bucket

1. **R2 → Manage R2 API Tokens → Create API Token**.
2. Otorgar permiso **Object Read & Write** limitado únicamente al bucket creado en el paso 1 —
   nunca un token con acceso a todos los buckets de la cuenta.
3. Guardar el `Access Key ID` y el `Secret Access Key` resultantes como
   `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` en el gestor de secretos del ambiente
   correspondiente (nunca en el repositorio, el chat, commits o documentación).
4. Anotar el `Account ID` de Cloudflare (visible en el dashboard) como `R2_ACCOUNT_ID`.

## 3. Endpoint S3 de Cloudflare R2

R2 expone una API compatible con S3 en:

```
https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

`R2SignatureAssetStorageAdapter` construye el cliente (`@aws-sdk/client-s3`) exactamente con este
endpoint, `region: "auto"` y las credenciales del paso 2 — nunca `forcePathStyle` (no es necesario
para el patrón de uso de este proyecto, un bucket fijo conocido de antemano). El cliente se crea
de forma perezosa (solo la primera vez que se sube, verifica o elimina un objeto) y **nunca** se
construye cuando `SIGNATURE_ASSET_STORAGE_MODE=simulated` — en ese modo no se realiza ninguna
solicitud a Cloudflare.

## 4. Conectar el bucket a un dominio personalizado (HTTPS)

1. **R2 → (bucket) → Settings → Public Access → Custom Domains → Connect Domain**.
2. Usar un subdominio dedicado, por ejemplo `assets.mejoreferido.com` (producción) o
   `assets-staging.mejoreferido.com` (staging) — nunca el dominio `r2.dev` que Cloudflare ofrece
   por defecto, que no es apto para producción.
3. Cloudflare emite y renueva el certificado TLS automáticamente para ese subdominio una vez
   conectado (no se requiere configuración manual de certificados).
4. La validación de entorno (`env.validation.ts`) **rechaza arrancar** la API en modo `r2` si
   `R2_PUBLIC_BASE_URL` no usa `https://` o si contiene `r2.dev`.

## 5. Variables de entorno

```env
SIGNATURE_ASSET_STORAGE_MODE=r2
R2_ACCOUNT_ID=<account id de Cloudflare>
R2_ACCESS_KEY_ID=<access key del token limitado al bucket>
R2_SECRET_ACCESS_KEY=<secret key del token limitado al bucket>
R2_BUCKET_NAME=mr-outreach-production-assets
R2_PUBLIC_BASE_URL=https://assets.mejoreferido.com
R2_SIGNATURE_PREFIX=signatures
```

Cuando `SIGNATURE_ASSET_STORAGE_MODE=r2`, las 4 variables `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` son obligatorias, `R2_PUBLIC_BASE_URL` debe ser HTTPS y
nunca `r2.dev`, y `R2_SIGNATURE_PREFIX` debe ser un segmento de ruta seguro (sin `..`, sin barra
inicial/final). La API se niega a iniciar si cualquiera de estas reglas falla.

Cuando `SIGNATURE_ASSET_STORAGE_MODE=simulated` (por defecto, desarrollo/test): ninguna variable
`R2_*` es obligatoria, no se construye el cliente S3 y no se realiza ninguna solicitud a
Cloudflare — las imágenes se escriben en
`apps/api/uploads/signatures/{organizationId}/{userId}/{assetId}.{extensión}` y se sirven a
través del mismo mount estático `/uploads/*` que `main.ts` ya expone.

Las credenciales (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) se leen únicamente en el backend, a
través de `AppConfigService`. Nunca llegan al frontend, al HTML, al JSON de la Plantilla, a
PostgreSQL, a la auditoría, a los logs ni a un mensaje de error — `R2SignatureAssetStorageAdapter`
sanitiza cualquier error del SDK antes de propagarlo (ver §"Manejo de errores" más abajo).

## 6. Carga real de objetos (PutObject)

`uploadImage` ejecuta un `PutObjectCommand` real con:

- `Bucket`: `R2_BUCKET_NAME`.
- `Key`: `{R2_SIGNATURE_PREFIX}/{organizationId}/{userId}/{assetId}.{extensión}` (inmutable — cada
  carga genera un `assetId` nuevo, nunca sobrescribe un objeto existente).
- `Body`, `ContentType`, `ContentLength`.
- `CacheControl: "public, max-age=31536000, immutable"` — el objeto nunca cambia una vez subido.

La carga se considera exitosa únicamente si el SDK no arroja error. Si `PutObject` falla, no se
persiste ningún registro `SignatureAsset` (el registro local solo se crea después de que la
subida al almacenamiento haya confirmado éxito — ver `SignatureAssetsService.upload`), no se
devuelve ninguna URL, y se registra un aviso sanitizado (sin credenciales, sin cuerpo binario, sin
la respuesta completa del SDK).

## 7. Verificación de existencia (HeadObject)

`validateAssetExistence` ejecuta un `HeadObjectCommand` real y distingue tres resultados:

- **Objeto inexistente** (`NoSuchKey`/`NotFound`/404): `{ exists: false }`, sin lanzar error.
- **Acceso denegado** (401/403/`AccessDenied`): lanza `SignatureAssetAccessDenied` — un problema
  de configuración/autorización, nunca confundido con "no existe".
- **Fallo técnico** (timeout, red, 5xx, respuesta inválida): lanza `SignatureAssetStorageUnavailable`.

## 8. Eliminación real (DeleteObject)

`SignatureAssetsService.deleteUnreferencedImage` es el único punto de entrada: carga el activo
local, valida `organizationId`, revisa que no esté ya `DELETED`, y comprueba TODAS las
referencias existentes — el borrador actual de cada Plantilla propia (`signatureHtml`) y cada una
de sus versiones ya publicadas e inmutables. Si el activo está referenciado, rechaza la
eliminación con `SignatureAssetStillReferenced` sin tocar R2. Solo si no hay ninguna referencia
ejecuta `DeleteObjectCommand` real, marca el registro local como `DELETED` con su `deletedAt`, y
registra auditoría (`signature_asset.delete`). Un objeto que el SDK reporta como ya inexistente
(`NoSuchKey`/404) se trata como éxito idempotente, no como error.

**Una versión de Plantilla ya publicada nunca puede perder su imagen**: mientras cualquier
versión (incluida una antigua, ya reemplazada por una más nueva) siga conteniendo la URL del
activo en su `signatureHtml` congelado, ese activo es indeleble.

No se implementa limpieza automática, cron ni job recurrente — `markStaleAvailableAssetsOrphaned`
queda preparado como un método invocable manualmente (o desde un futuro job) que solo marca
activos `AVAILABLE` sin referencia y con más de 30 días como `ORPHANED`; nunca borra nada por sí
mismo.

## 9. Manejo de errores

Los errores públicos (`SignatureAssetUploadFailed`, `SignatureAssetNotFound`,
`SignatureAssetStorageUnavailable`, `SignatureAssetAccessDenied`, `SignatureAssetStillReferenced`)
nunca incluyen el mensaje original del SDK, un stack trace, cabeceras de autorización ni
credenciales. Los logs (`Logger.warn`) registran únicamente la operación, el `objectKey`, el
código de error normalizado (p. ej. `NoSuchKey`, `AccessDenied`) — nunca el cuerpo binario ni las
credenciales.

## 10. Diferencia entre `simulated` y `r2`

| | `simulated` | `r2` |
|---|---|---|
| Cliente S3 | Nunca se construye | Se construye de forma perezosa al primer uso |
| Solicitudes a Cloudflare | Ninguna | PutObject / HeadObject / DeleteObject reales |
| Almacenamiento | `apps/api/uploads/signatures/...` (disco local) | Bucket R2 real |
| Variables `R2_*` obligatorias | Ninguna | Las 4 credenciales + `R2_PUBLIC_BASE_URL` HTTPS no-`r2.dev` |
| Uso previsto | Desarrollo y pruebas | Staging y producción |

## 11. Tratamiento de activos históricos

Reemplazar una imagen de firma significa siempre cargar un objeto nuevo con un `assetId` nuevo —
nunca se sobrescribe el anterior. Una Plantilla ya publicada conserva la URL exacta de la imagen
con la que se publicó dentro de su versión congelada; las Gestiones ya iniciadas siguen usando
esa misma versión y, por lo tanto, esa misma imagen, sin importar cuántas veces se reemplace la
imagen en borradores posteriores.

## 12. Verificar acceso público sin autenticación

Una vez configurado el dominio personalizado:

```
curl -I https://assets.mejoreferido.com/signatures/<organizationId>/<userId>/<assetId>.png
```

debe responder `200 OK` **sin ninguna cabecera de autenticación** — los clientes de correo de los
destinatarios deben poder cargar la imagen sin credenciales, igual que cualquier imagen alojada en
un CDN público.

## 13. Smoke test contra un bucket real (cuando existan credenciales)

1. Configurar `SIGNATURE_ASSET_STORAGE_MODE=r2` con credenciales de un bucket de **desarrollo**
   (nunca producción) en el entorno donde se ejecuta la prueba.
2. Cargar un PNG pequeño a través de `POST /signature-assets`.
3. Confirmar que el objeto quedó en el bucket (`PutObject` exitoso — verificable también en el
   dashboard de Cloudflare).
4. Ejecutar `validateAssetExistence` (`HeadObject`) y confirmar `exists: true`.
5. Abrir la URL pública devuelta en el navegador y confirmar que la imagen carga.
6. Publicar una Plantilla cuya firma use esa URL.
7. Crear un activo de prueba sin referencias y ejecutar
   `SignatureAssetsService.deleteUnreferencedImage`.
8. Confirmar mediante `HeadObject` que el objeto ya no existe (`exists: false`).

No usar imágenes ni datos productivos para este smoke test. Este repositorio **no ejecutó** este
smoke test contra un bucket real — ver el informe de la tarea para el estado exacto.
