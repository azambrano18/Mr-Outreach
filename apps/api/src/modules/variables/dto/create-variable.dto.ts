import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizeVariableKey } from '@outreach/validation';
import { IsValidVariableKey } from '../validators/valid-variable-key.decorator';

/** Simplified per spec §5.1 — just the two fields the insert-dropdown actually needs. */
export class CreateVariableDto {
  @ApiProperty({
    description:
      'Technical identifier used as {key} in templates. Lowercase letters, digits, underscore, cannot start with a digit.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeVariableKey(value) : value))
  @IsString()
  @IsValidVariableKey()
  key!: string;

  @ApiProperty({ description: 'Human-readable name, e.g. "Nombre del contacto".' })
  @IsString()
  @IsNotEmpty()
  label!: string;
}
