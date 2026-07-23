import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MailboxEncryption } from '../../../domain/mailbox/mailbox.entity';

const ENCRYPTION_VALUES: MailboxEncryption[] = ['SSL_TLS', 'STARTTLS', 'NONE'];

export class ProtocolConfigDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  host!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ enum: ENCRYPTION_VALUES })
  @IsIn(ENCRYPTION_VALUES)
  encryption!: MailboxEncryption;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: 'Plaintext in the request only — encrypted before it is stored.' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiProperty()
  @IsBoolean()
  verifyCertificate!: boolean;
}

export class UpdateProtocolConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  host?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ enum: ENCRYPTION_VALUES })
  @IsOptional()
  @IsIn(ENCRYPTION_VALUES)
  encryption?: MailboxEncryption;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @ApiPropertyOptional({
    description: 'Omit to keep the currently stored secret unchanged.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  verifyCertificate?: boolean;
}
