import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateVariableInput,
  UpdateVariableInput,
  Variable,
} from '../../../domain/variable/variable.entity';
import { VariableRepository } from '../../../domain/variable/variable.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryVariableRepository implements VariableRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Variable | null> {
    return this.store.variables.get(id) ?? null;
  }

  async findByKey(organizationId: string, key: string): Promise<Variable | null> {
    for (const variable of this.store.variables.values()) {
      if (variable.organizationId === organizationId && variable.key === key) {
        return variable;
      }
    }
    return null;
  }

  async findAll(organizationId: string): Promise<Variable[]> {
    return Array.from(this.store.variables.values()).filter(
      (variable) => variable.organizationId === organizationId,
    );
  }

  async create(input: CreateVariableInput): Promise<Variable> {
    const existing = await this.findByKey(input.organizationId, input.key);
    if (existing) {
      throw new ConflictException('A variable with this key already exists in the organization.');
    }

    const now = new Date();
    const variable: Variable = {
      id: randomUUID(),
      organizationId: input.organizationId,
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      source: input.source,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.store.variables.set(variable.id, variable);
    return variable;
  }

  async update(id: string, input: UpdateVariableInput): Promise<Variable> {
    const existing = this.store.variables.get(id);
    if (!existing) {
      throw new ConflictException('Variable not found.');
    }

    if (input.key !== undefined && input.key !== existing.key) {
      const clash = await this.findByKey(existing.organizationId, input.key);
      if (clash) {
        throw new ConflictException('A variable with this key already exists in the organization.');
      }
    }

    const updated: Variable = { ...existing, ...input, updatedAt: new Date() };
    this.store.variables.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.store.variables.delete(id);
  }
}
