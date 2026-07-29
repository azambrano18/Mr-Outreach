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

## 3. Conectar el bucket a un dominio personalizado

1. **R2 → (bucket) → Settings → Public Access → Custom Domains → Connect Domain**.
2. Usar un subdominio dedicado, por ejemplo `assets.mejoreferido.com` (producción) o
   `assets-staging.mejoreferido.com` (staging) — nunca el dominio `r2.dev` que Cloudflare ofrece
   por defecto, que no es apto para producción.
3. Cloudflare emite y renueva el certificado TLS automáticamente para ese subdominio una vez
   conectado (no se requiere configuración manual de certificados).

## 4. Configurar `R2_PUBLIC_BASE_URL`

Una vez el dominio está conectado y sirviendo tráfico:

```env
R2_PUBLIC_BASE_URL=https://assets.mejoreferido.com
R2_SIGNATURE_PREFIX=signatures
R2_BUCKET_NAME=mr-outreach-production-assets
```

Este valor es el que el sanitizador de firmas (`HtmlSanitizerService.sanitizeSignatureHtml`) usa
para decidir qué `<img src>` sobrevive dentro de una firma — cualquier otro origen se elimina.

## 5. Verificar acceso público sin autenticación

Subir manualmente un archivo de prueba al bucket (o esperar la primera carga real desde Mr
Outreach) y confirmar que:

```
curl -I https://assets.mejoreferido.com/signatures/<organizationId>/<userId>/<assetId>.png
```

responde `200 OK` **sin ninguna cabecera de autenticación** — los clientes de correo de los
destinatarios deben poder cargar la imagen sin credenciales, igual que cualquier imagen alojada
en un CDN público.

## 6. Nunca usar `r2.dev` en producción

El subdominio automático `<bucket>.r2.dev` que Cloudflare ofrece por defecto:

- No admite un certificado TLS con el nombre de marca propio.
- No es apto como URL final embebida en correos enviados a terceros.
- Puede cambiar de comportamiento sin aviso al no ser un dominio controlado por la organización.

`R2_PUBLIC_BASE_URL` debe apuntar siempre al dominio personalizado del paso 3.

## Estado de la integración en este repositorio

El adaptador `R2SignatureAssetStorageAdapter`
(`apps/api/src/infrastructure/signature-asset-storage/r2/r2-signature-asset-storage-adapter.ts`)
sigue el mismo patrón que `S3ImageStorageAdapter` ya usaba en este proyecto para el puerto de
imágenes genérico: el driver existe y es seleccionable (`SIGNATURE_ASSET_STORAGE_MODE=r2`), la
validación de entorno ya exige las 4 variables `R2_*` para arrancar en ese modo, pero **la
llamada real de `PutObject`/`DeleteObject`/`HeadObject` todavía no está implementada** — este
ambiente de desarrollo no tiene un bucket real ni credenciales. Cuando existan:

1. Agregar `@aws-sdk/client-s3` (R2 es compatible con la API S3).
2. Reemplazar el cuerpo de `uploadImage`/`deleteUnreferencedImage`/`validateAssetExistence` en
   `R2SignatureAssetStorageAdapter` por las llamadas reales firmadas (SigV4), usando
   `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`.
3. Nada más en la aplicación necesita cambiar — `SignatureAssetsService`, el controlador
   `POST /signature-assets` y el editor de firma ya dependen únicamente del puerto
   `SignatureAssetStoragePort`, no del adaptador concreto.

El modo `simulated` (`SimulatedSignatureAssetStorageAdapter`) es completamente funcional hoy:
escribe en `apps/api/uploads/signatures/{organizationId}/{userId}/{assetId}.{extensión}` y lo
sirve a través del mismo mount estático `/uploads/*` que `main.ts` ya expone — sin necesidad de
credenciales ni de una ruta de desarrollo adicional.
