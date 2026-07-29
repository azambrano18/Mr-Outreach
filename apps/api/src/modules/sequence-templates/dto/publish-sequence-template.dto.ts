import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class PublishSequenceTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}
