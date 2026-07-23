import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { normalizeVariableKey } from '@outreach/validation';
import { IsValidVariableKey } from '../validators/valid-variable-key.decorator';

export class UpdateVariableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeVariableKey(value) : value))
  @IsString()
  @IsValidVariableKey()
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;
}
