import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ConversationManagementStatus } from '../../../domain/conversation/conversation.entity';

const STATUSES: ConversationManagementStatus[] = [
  'NEW',
  'PENDING',
  'IN_PROGRESS',
  'RESOLVED',
  'ARCHIVED',
];

export class UpdateConversationStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  managementStatus!: ConversationManagementStatus;
}
