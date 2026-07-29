import { TransactionContext } from '../persistence/transaction';
import { CreateUserInput, UpdateUserInput, User } from './user.entity';

export interface UserRepository {
  findById(id: string, ctx?: TransactionContext): Promise<User | null>;
  findByEmail(organizationId: string, email: string): Promise<User | null>;
  /**
   * Used only by the login flow, which does not know the organization
   * ahead of time. Org-scoped lookups (e.g. uniqueness checks when
   * creating a user) must use findByEmail instead.
   */
  findByEmailAnyOrganization(email: string): Promise<User | null>;
  findAll(organizationId: string): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, input: UpdateUserInput): Promise<User>;
}
