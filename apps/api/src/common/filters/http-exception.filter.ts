import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

interface UniformErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown[];
    correlationId: string;
    retryable: boolean;
  };
}

/**
 * Normalizes every thrown error (HTTP or unexpected) into a single JSON
 * shape, mirroring the error contract used for the app <-> engine API.
 * Never includes secrets: only the exception's own message/response body.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const { code, message, details, retryable } = this.normalize(exception, status);

    const body: UniformErrorBody = {
      error: { code, message, details, correlationId, retryable },
    };

    this.logger.error(`[${correlationId}] ${request.method} ${request.url} -> ${status} ${code}`);

    response.status(status).json(body);
  }

  private normalize(
    exception: unknown,
    status: number,
  ): { code: string; message: string; details: unknown[]; retryable: boolean } {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : (((payload as Record<string, unknown>).message as string) ?? exception.message);
      const details = Array.isArray((payload as Record<string, unknown>)?.message)
        ? ((payload as Record<string, unknown>).message as unknown[])
        : [];

      return {
        code: HttpStatus[status] ?? 'HTTP_ERROR',
        message: Array.isArray(message) ? 'Validation failed' : message,
        details,
        retryable: status >= 500,
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: [],
      retryable: true,
    };
  }
}
