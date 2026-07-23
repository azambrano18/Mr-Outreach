import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class AdvanceProvisioningDto {
  @ApiProperty({ enum: ['ONE', 'ALL'] })
  @IsIn(['ONE', 'ALL'])
  mode!: 'ONE' | 'ALL';
}
