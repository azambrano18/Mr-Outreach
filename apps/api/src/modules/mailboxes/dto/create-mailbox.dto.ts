import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ProtocolConfigDto } from './protocol-config.dto';

export class CreateMailboxDto {
  @ApiProperty({ description: 'Identifying name for the account, e.g. "Ventas Chile".' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Display name used as the sender.' })
  @IsString()
  @IsNotEmpty()
  fromName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiProperty({ type: ProtocolConfigDto })
  @ValidateNested()
  @Type(() => ProtocolConfigDto)
  imap!: ProtocolConfigDto;

  @ApiProperty({ type: ProtocolConfigDto })
  @ValidateNested()
  @Type(() => ProtocolConfigDto)
  smtp!: ProtocolConfigDto;
}
