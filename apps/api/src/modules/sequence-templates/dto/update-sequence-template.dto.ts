import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** §1/§4/§5 (Fase 1.7) — `name` is optional here (editing an existing draft), but when sent must pass the same rules as creation. `subjectTemplate` is shared across the 3 envíos. No `headerText` here — header is per-envío, see UpdateSequenceTemplateStepDto. */
export class UpdateSequenceTemplateDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(120, { message: 'El nombre no puede superar los 120 caracteres.' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectTemplate?: string;
}
