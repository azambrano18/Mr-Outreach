import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateSimulationConversationsDto {
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;
}
