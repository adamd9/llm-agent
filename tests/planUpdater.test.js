const planUpdater = require('../src/tools/planUpdater');

const mockChat = jest.fn();
jest.mock('../src/utils/openaiClient.js', () => ({
  getOpenAIClient: () => ({ chat: mockChat })
}));

describe('planUpdater tool', () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  test('returns replan when update needed', async () => {
    const plan = [
      { tool: 'dummy', action: 'a', parameters: [], description: 'step1' },
      { tool: 'dummy', action: 'b', parameters: [], description: 'step2' }
    ];

    const responseObj = {
      needs_update: true,
      reason: 'adjust',
      updated_plan: { steps: plan },
      next_step_index: 1
    };
    mockChat.mockResolvedValue({ content: JSON.stringify(responseObj) });

    const results = [
      { tool: 'dummy', action: 'a', result: { status: 'success', data: {} } }
    ];
    const res = await planUpdater.execute('evalForUpdate', [{ name: 'currentStepNumber', value: 0 }], plan, results);
    expect(res.status).toBe('replan');
    expect(res.updatedPlan.steps).toEqual(plan);
    expect(res.nextStepIndex).toBe(1);
  });

  test('returns success when no update', async () => {
    const plan = [
      { tool: 'dummy', action: 'a', parameters: [], description: 'step1' },
      { tool: 'dummy', action: 'b', parameters: [], description: 'step2' }
    ];

    const responseObj = {
      needs_update: false,
      reason: 'fine',
      updated_plan: { steps: plan },
      next_step_index: 2
    };
    mockChat.mockResolvedValue({ content: JSON.stringify(responseObj) });

    const results = [
      { tool: 'dummy', action: 'a', result: { status: 'success', data: {} } },
      { tool: 'dummy', action: 'b', result: { status: 'success', data: {} } }
    ];
    const res = await planUpdater.execute('evalForUpdate', [{ name: 'currentStepNumber', value: 1 }], plan, results);
    expect(res.status).toBe('success');
    expect(res.nextStepIndex).toBe(2);
  });
});
