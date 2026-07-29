import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** §12 — everything an executive may still change while a Gestión is DRAFT; `name` stays auto-generated (only once submitted) and there is no start date/time to edit. */
export class UpdateDraftSequenceExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mailboxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateId?: string;
}
