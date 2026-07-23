import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { validateTemplateVariables } from '@outreach/validation';

/**
 * Validates the {variable} syntax of a template field (subject or body,
 * applied independently to each) using the same rules the web app's live
 * editor preview uses — @outreach/validation is the single source of truth
 * for both.
 */
export function IsValidTemplateText(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isValidTemplateText',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && validateTemplateVariables(value).valid;
        },
        defaultMessage(args: ValidationArguments): string {
          if (typeof args.value !== 'string') {
            return `${args.property} must be a string.`;
          }
          return validateTemplateVariables(args.value).errors.join(' ');
        },
      },
    });
  };
}
