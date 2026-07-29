import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Domain-level errors for signature-asset storage operations. Every one of
 * these carries only a sanitized, human-safe message — never an SDK
 * response body, a stack trace, a header, or a credential (see
 * R2SignatureAssetStorageAdapter's `toSanitizedStorageError`, the only
 * place these are ever constructed from a raw AWS SDK error).
 */
export class SignatureAssetUploadFailed extends ServiceUnavailableException {
  constructor(message = 'No se pudo cargar la imagen al almacenamiento de firmas.') {
    super(message);
  }
}

export class SignatureAssetNotFound extends NotFoundException {
  constructor(message = 'El activo de firma no existe.') {
    super(message);
  }
}

export class SignatureAssetStorageUnavailable extends ServiceUnavailableException {
  constructor(message = 'El almacenamiento de firmas no está disponible en este momento.') {
    super(message);
  }
}

/** A misconfiguration/authorization problem with the storage backend itself — never the end user's fault, never conflated with "object not found". */
export class SignatureAssetAccessDenied extends ForbiddenException {
  constructor(message = 'Acceso denegado al almacenamiento de firmas. Revisa la configuración de credenciales.') {
    super(message);
  }
}

export class SignatureAssetStillReferenced extends ConflictException {
  constructor(message = 'Esta imagen todavía está referenciada por una Plantilla o versión y no puede eliminarse.') {
    super(message);
  }
}
