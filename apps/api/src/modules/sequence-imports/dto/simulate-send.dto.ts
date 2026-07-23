import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class SimulateSendDto {
  @ApiPropertyOptional({ enum: ['SENT', 'RETRY', 'FAILED'] })
  @IsOptional()
  @IsIn(['SENT', 'RETRY', 'FAILED'])
  outcome?: 'SENT' | 'RETRY' | 'FAILED';
}
