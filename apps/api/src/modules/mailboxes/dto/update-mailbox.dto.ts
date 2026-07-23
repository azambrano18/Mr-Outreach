import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UpdateProtocolConfigDto } from './protocol-config.dto';

export class UpdateMailboxDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fromName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiPropertyOptional({ type: UpdateProtocolConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProtocolConfigDto)
  imap?: UpdateProtocolConfigDto;

  @ApiPropertyOptional({ type: UpdateProtocolConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProtocolConfigDto)
  smtp?: UpdateProtocolConfigDto;
}
