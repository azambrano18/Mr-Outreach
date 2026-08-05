import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class PauseSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class ResumeSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class StopSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;

  /** Required, 3-300 chars — enforced again in ControlSequenceExecutionUseCase since this DTO field is optional at the transport layer. */
  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class RestartSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}
