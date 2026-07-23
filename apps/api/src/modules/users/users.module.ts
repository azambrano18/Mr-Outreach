import { Module } from '@nestjs/common';
import { UsersService } from '../../application/users/users.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { UsersController } from './users.controller';

@Module({
  imports: [PersistenceModule, AuthModule, ClientsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
