import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';

export class SetMailboxAssigneesDto {
  @ApiPropertyOptional({
    description: 'The single primary responsible executive, or null/omitted for none.',
  })
  @IsOptional()
  @IsString()
  primaryUserId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Full desired list of secondary executive ids, replacing any previous set.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  secondaryUserIds?: string[];
}
