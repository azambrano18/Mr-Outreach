import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** §5 — wizard step 1 ("Configuración general"): client + sender account + management date, all at once. */
export class CreateWizardSequenceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD', example: '2026-07-20' })
  @IsString()
  @Matches(ISO_DATE, { message: 'managementDate debe tener formato YYYY-MM-DD.' })
  managementDate!: string;
}
