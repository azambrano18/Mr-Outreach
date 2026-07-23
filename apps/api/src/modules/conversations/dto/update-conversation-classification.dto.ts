import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ConversationClassification } from '../../../domain/conversation/conversation.entity';

const CLASSIFICATIONS: ConversationClassification[] = [
  'INTERESTED',
  'NOT_INTERESTED',
  'REQUESTS_INFORMATION',
  'FOLLOW_UP_LATER',
  'WRONG_CONTACT',
  'OUT_OF_OFFICE',
  'AUTOMATIC_REPLY',
  'HARD_BOUNCE',
  'SOFT_BOUNCE',
  'UNSUBSCRIBE',
  'UNCLASSIFIED',
];

export class UpdateConversationClassificationDto {
  @ApiProperty({ enum: CLASSIFICATIONS })
  @IsIn(CLASSIFICATIONS)
  classification!: ConversationClassification;
}
