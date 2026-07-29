import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** §1 (Fase 1.7) — the executive must type a name identifying the Plantilla's purpose; it is never auto-generated. */
export class CreateSequenceTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;

  @ApiProperty({ minLength: 3, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la plantilla es obligatorio.' })
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(120, { message: 'El nombre no puede superar los 120 caracteres.' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
