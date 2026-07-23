import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateConversationAssignmentDto {
  @ApiPropertyOptional({ description: 'The executive to assign, or null to unassign.' })
  @IsOptional()
  @IsString()
  assignedExecutiveId?: string | null;
}
