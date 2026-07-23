import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AssociateConversationDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  clientId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  domainId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  sequenceId?: string | null;
}
