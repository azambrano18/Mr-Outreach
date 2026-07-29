import { NotFoundException } from '@nestjs/common';
import { DevSimulatedExecutionStateService } from '../../application/sequence-executions/dev-simulated-execution-state.service';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { DevSimulatedExecutionsController } from './dev-simulated-executions.controller';

describe('DevSimulatedExecutionsController', () => {
  let simulation: jest.Mocked<Pick<DevSimulatedExecutionStateService, 'apply'>>;
  const user = { id: 'admin_1', organizationId: 'org_1' } as any;

  function buildController(configOverrides: Partial<{ sequenceMotorMode: string; nodeEnv: string }>) {
    const config = {
      sequenceMotorMode: 'simulated',
      nodeEnv: 'development',
      ...configOverrides,
    } as unknown as AppConfigService;
    return new DevSimulatedExecutionsController(config, simulation as unknown as DevSimulatedExecutionStateService);
  }

  beforeEach(() => {
    simulation = { apply: jest.fn().mockResolvedValue({ id: 'run_1', status: 'COMPLETED' }) };
  });

  it('404s (never a plain 403) when SEQUENCE_MOTOR_MODE=http — the tool must not exist against a real motor', () => {
    const controller = buildController({ sequenceMotorMode: 'http' });
    expect(() => controller.getConfig()).toThrow(NotFoundException);
    expect(controller.setState(user, 'run_1', { status: 'COMPLETED' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when NODE_ENV=production, regardless of the motor mode', () => {
    const controller = buildController({ nodeEnv: 'production' });
    expect(() => controller.getConfig()).toThrow(NotFoundException);
    expect(controller.setState(user, 'run_1', { status: 'COMPLETED' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when both conditions fail at once', () => {
    const controller = buildController({ sequenceMotorMode: 'http', nodeEnv: 'production' });
    expect(() => controller.getConfig()).toThrow(NotFoundException);
  });

  it('is reachable and delegates to the service when simulated + non-production', async () => {
    const controller = buildController({});
    expect(controller.getConfig()).toEqual({ enabled: true });

    const dto = { status: 'COMPLETED' } as any;
    const result = await controller.setState(user, 'run_1', dto);
    expect(simulation.apply).toHaveBeenCalledWith('org_1', 'admin_1', 'run_1', dto);
    expect(result).toEqual({ id: 'run_1', status: 'COMPLETED' });
  });

  it('never calls the simulation service at all when the gate fails, even if a caller somehow bypassed the guards', async () => {
    const controller = buildController({ sequenceMotorMode: 'http' });
    await expect(controller.setState(user, 'run_1', { status: 'COMPLETED' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(simulation.apply).not.toHaveBeenCalled();
  });
});
