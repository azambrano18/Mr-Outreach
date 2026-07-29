import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class StartSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}
