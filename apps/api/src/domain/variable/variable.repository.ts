import { CreateVariableInput, UpdateVariableInput, Variable } from './variable.entity';

export interface VariableRepository {
  findById(id: string): Promise<Variable | null>;
  findByKey(organizationId: string, key: string): Promise<Variable | null>;
  findAll(organizationId: string): Promise<Variable[]>;
  create(input: CreateVariableInput): Promise<Variable>;
  update(id: string, input: UpdateVariableInput): Promise<Variable>;
  /** Hard delete — only ever called after confirming the key is unused (see VariablesService.remove). */
  remove(id: string): Promise<void>;
}
