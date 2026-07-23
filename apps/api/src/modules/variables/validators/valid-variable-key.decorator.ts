import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidVariableKey } from '@outreach/validation';

/**
 * Validates a catalog variable's key with the same rules a {key}
 * reference inside template text must satisfy — @outreach/validation is
 * the single source of truth for both (see TemplatesService's
 * IsValidTemplateText for the template-text side of the same rules).
 */
export function IsValidVariableKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isValidVariableKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidVariableKey(value);
        },
        defaultMessage(): string {
          return `${propertyName} must contain only letters, digits and underscores, and must not start with a digit.`;
        },
      },
    });
  };
}
