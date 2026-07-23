import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Admin equivalent of CreateWizardSequenceDto — see CreateWizardSequenceForExecutivePayload for the extra field. */
export class CreateWizardSequenceForExecutiveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  domainId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-07-20' })
  @IsString()
  @Matches(ISO_DATE, { message: 'managementDate debe tener formato YYYY-MM-DD.' })
  managementDate!: string;

  @ApiPropertyOptional({
    description:
      'If the mailbox is not yet assigned to the target executive, set this to true to authorize the assignment as part of this call. Otherwise the request is rejected.',
  })
  @IsOptional()
  @IsBoolean()
  authorizeMailboxAssignment?: boolean;
}
