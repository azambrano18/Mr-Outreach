import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ADMIN_PERMISSION_KEYS, EXECUTIVE_PERMISSION_KEYS } from '../../seed/permission-catalog';
import { SimulateExecutionStateDto } from './simulate-execution-state.dto';

describe('SimulateExecutionStateDto', () => {
  it('accepts every documented simulatable state', async () => {
    for (const status of ['ACCEPTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED']) {
      const dto = plainToInstance(SimulateExecutionStateDto, { status });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects a status outside the allowed set', async () => {
    const dto = plainToInstance(SimulateExecutionStateDto, { status: 'SENT' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('rejects a missing status', async () => {
    const dto = plainToInstance(SimulateExecutionStateDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('accepts an optional sanitized errorMessage/errorCode for FAILED/REJECTED', async () => {
    const dto = plainToInstance(SimulateExecutionStateDto, {
      status: 'FAILED',
      errorCode: 'SIMULATED_DELIVERY_FAILURE',
      errorMessage: 'Fallo simulado para validación visual',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an excessively long errorMessage instead of storing it unsanitized', async () => {
    const dto = plainToInstance(SimulateExecutionStateDto, { status: 'FAILED', errorMessage: 'x'.repeat(501) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'errorMessage')).toBe(true);
  });
});

describe('dev_tools.simulate_execution_state permission wiring', () => {
  it('is granted to the admin role', () => {
    expect(ADMIN_PERMISSION_KEYS).toContain('dev_tools.simulate_execution_state');
  });

  it('is never granted to the executive role — an executive can never force a simulated state, even by direct API call', () => {
    expect(EXECUTIVE_PERMISSION_KEYS).not.toContain('dev_tools.simulate_execution_state');
  });
});
