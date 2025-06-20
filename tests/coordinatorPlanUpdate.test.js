const { executePlan } = require('../src/core/coordinator');
const toolManager = require('../src/mcp');

jest.mock('../src/mcp', () => ({
  getAllTools: jest.fn(),
}));

const planUpdaterTool = { name: 'planUpdater', execute: jest.fn() };
const dummyTool = { name: 'dummy', execute: jest.fn() };

describe('executePlan replan handling', () => {
  beforeEach(() => {
    planUpdaterTool.execute.mockReset();
    dummyTool.execute.mockReset();
    toolManager.getAllTools.mockResolvedValue([planUpdaterTool, dummyTool]);
  });

  test('updated plan is executed when planUpdater requests replan', async () => {
    const initialPlan = [
      { tool: 'planUpdater', action: 'evalForUpdate', parameters: [{ name: 'currentStepNumber', value: 0 }], description: 'check' },
      { tool: 'dummy', action: 'original', parameters: [], description: 'orig step' }
    ];

    planUpdaterTool.execute.mockResolvedValue({
      status: 'replan',
      message: 'update',
      updatedPlan: { steps: [ { tool: 'dummy', action: 'updated', parameters: [], description: 'new step' } ] },
      nextStepIndex: 0
    });

    dummyTool.execute.mockResolvedValue({ status: 'success' });

    const result = await executePlan(initialPlan);

    expect(dummyTool.execute).toHaveBeenCalledTimes(1);
    expect(dummyTool.execute.mock.calls[0][0]).toBe('updated');
    expect(result.status).toBe('success');
  });
});
