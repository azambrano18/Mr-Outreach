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
  /**
   * Same lookup as `findByEmail`, but including a soft-deleted row — the
   * ONLY place this distinction matters is UsersService.create's
   * restore-on-create-by-email flow, which needs to tell "no user ever
   * existed with this email" apart from "a user existed and was deleted"
   * to decide whether to insert a new row or restore the old one. Never
   * used to authorize or display anything else.
   */
  findByEmailIncludingDeleted(organizationId: string, email: string): Promise<User | null>;
  findAll(organizationId: string): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, input: UpdateUserInput): Promise<User>;
}
