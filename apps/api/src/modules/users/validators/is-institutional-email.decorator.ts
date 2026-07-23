import { registerDecorator, ValidationOptions } from 'class-validator';
import { isInstitutionalEmail, INSTITUTIONAL_EMAIL_DOMAIN } from '@outreach/validation';

/**
 * Executives must authenticate with an institutional @mejoreferido.cl
 * address — @outreach/validation is the single source of truth, mirrored
 * on the frontend so the same rule is enforced before submit, not just
 * server-side (see IsValidVariableKey for the same shared-validator pattern).
 */
export function IsInstitutionalEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isInstitutionalEmail',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isInstitutionalEmail(value);
        },
        defaultMessage(): string {
          return `${propertyName} must be an institutional @${INSTITUTIONAL_EMAIL_DOMAIN} email address.`;
        },
      },
    });
  };
}
