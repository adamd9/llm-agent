# Implementation Plan: REACT-Style Ego Coordinator

## Current System Analysis

The current LLM agent implementation utilizes a "plan-then-execute" approach:

1. **Initial Planning**: The planner creates a comprehensive plan for the entire task upfront
2. **Execution**: The coordinator executes each step sequentially
3. **Replanning**: Only occurs when explicitly triggered by a tool returning a "replan" status

This approach has several limitations:
- Plans become outdated as soon as execution begins
- The system struggles to adapt to dynamic changes
- Each replan requires regenerating an entire plan
- Lack of contextual awareness between steps

## Proposed REACT-Style Approach

The REACT (Reason + Act) paradigm follows a more iterative approach to agent execution while still maintaining strategic direction:

```
Initial Strategy -> Observation -> Thought -> Action -> Observation -> Thought -> Action -> ...
```

Instead of creating a detailed plan upfront, the agent:
1. Creates a high-level strategic approach and defines success criteria
2. Proceeds step-by-step, reasoning about the next best action based on the strategy, current state, and previous results
3. Continuously evaluates progress against the defined success criteria

### Core REACT Principles to Implement

1. **Strategic Framework**: Define high-level approach and success criteria upfront
2. **Single-Step Execution**: Plan and execute one step at a time
3. **Contextual Reasoning**: Add explicit reasoning that references the strategic approach before each action
4. **Progress Evaluation**: Assess each step's outcome against the success criteria
5. **Context Preservation**: Maintain full context of previous steps and results

## Implementation Strategy

### 1. Add Initial Strategy Formulation Phase

Before diving into execution, add a strategic planning phase that defines the approach and success criteria. The strategic planner should be aware of high-level tool capabilities but not specific parameters:

```javascript
async function strategicPlanner(enrichedMessage, client = null) {
  // Get high-level tool descriptions (names and descriptions only)
  const tools = await toolManager.getAllTools();
  const toolDescriptions = tools.map(tool => ({
    name: tool.name,
    description: tool.description
  }));
  
  // Read memory models for comprehensive context about self, user, and system
  const selfModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'self.md');
  const userModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'user.md');
  const systemModelPath = path.join(process.cwd(), 'src', 'core', 'systemModel.md');
  
  let selfModel = '';
  let userModel = '';
  let systemModel = '';
  
  if (fs.existsSync(selfModelPath)) {
    selfModel = fs.readFileSync(selfModelPath, 'utf-8');
  }
  
  if (fs.existsSync(userModelPath)) {
    userModel = fs.readFileSync(userModelPath, 'utf-8');
  }
  
  if (fs.existsSync(systemModelPath)) {
    systemModel = fs.readFileSync(systemModelPath, 'utf-8');
  }
  
  // Get additional context from long-term memory
  const recentInteractions = await memory.retrieveLongTerm('recent_interactions', 5) || [];
  
  // Add all context to the prompt for strategic planning
  const strategicPrompts = [
    { role: 'system', content: SYSTEM_PROMPT_STRATEGY },
    { role: 'user', content: formatStrategicPlanningRequest({
      originalMessage: enrichedMessage.original_message,
      toolDescriptions,
      selfModel,        // Agent's understanding of itself, capabilities, limitations
      userModel,       // User preferences, patterns, interaction history
      systemModel,     // Technical understanding of how the agent works
      recentInteractions
    })}
  ];
  
  // Generate high-level approach and descriptive success criteria
  return {
    approach: "High-level description of approach that factors in user needs and agent capabilities",
    successCriteria: ["Descriptive criterion 1", "Descriptive criterion 2", ...],
    estimatedSteps: null, // We don't presuppose a specific number of steps - could be 1 or many
    maxIterations: settings.maxREACTIterations || 10, // Hard iteration limit from settings
    complexityAssessment: "Simple/Moderate/Complex" // Assessment of task complexity
  };
}
```

### 2. Modify the Planner for Single-Step Planning

Update the planner to generate only the next logical step, with awareness of the strategy and progress:

```javascript
async function planner(enrichedMessage, strategy, previousSteps = [], client = null) {
  // Include strategy, success criteria, and previous steps in context
  // Reason about progress toward goals
  // Determine the next most appropriate step
  // Return a single step or decision to ask for more information
}
```

### 3. Create a New REACT-Style Coordinator Loop

Update the current coordinator with a REACT-style execution loop that maintains the strategic context:

```javascript
async function coordinator(enrichedMessage) {
  // 1. Generate the strategic approach and success criteria for this user interaction
  const strategy = await strategicPlanner(enrichedMessage);
  
  let completedSteps = [];
  let isDone = false;
  let iterations = 0;
  
  // Emit subsystem message with strategy (for debugging/UI)
  await sharedEventEmitter.emit('subsystemMessage', {
    module: 'coordinator',
    content: {
      type: 'strategy',
      strategy: strategy,
      message: enrichedMessage.original_message
    }
  });
  
  // Store strategy in memory for context (simpler implementation to start)
  await memory.storeShortTerm('Strategy', JSON.stringify(strategy));
  
  // Use the hard iteration limit from strategy or settings
  const maxIterations = strategy.maxIterations || 10;
  
  while (!isDone && iterations < maxIterations) {
    iterations++;
    
    // Check if this is a simple task and it's our first iteration
    if (strategy.complexityAssessment === 'Simple' && iterations === 1) {
      await sharedEventEmitter.emit('subsystemMessage', {
        module: 'coordinator',
        content: {
          type: 'complexity_assessment',
          assessment: 'Simple task detected, may complete in single step'
        }
      });
    }
    
    // 2. Plan the next step based on strategy and previous steps
    const nextStep = await planner(enrichedMessage, strategy, completedSteps);
    
    // 3. If the planner concludes the task is complete, evaluate against success criteria
    if (nextStep.status === 'complete') {
      const isSuccessful = await evaluateCompletion(completedSteps, strategy.successCriteria);
      if (isSuccessful) {
        isDone = true;
        continue;
      }
    }
    
    // 4. Execute the single step
    const result = await executeStep(nextStep);
    
    // 5. Evaluate the step result against success criteria
    const evaluation = await evaluateStepResult(result, nextStep, strategy);
    
    // 6. If evaluation shows we're off-track, attempt to replan with this new context
    if (!evaluation.isOnTrack && evaluation.confidence > 0.5) {
      // Log the deviation for debugging
      logger.debug('coordinator', 'Step evaluation indicates off-track execution', { 
        evaluation, 
        stepIndex: completedSteps.length 
      });
      
      await sharedEventEmitter.emit('systemStatusMessage', {
        message: `Adjusting approach based on new information...`,
        persistent: false
      });
      
      // We'll still add this step to completed steps, but mark it as requiring adjustment
      evaluation.requiresAdjustment = true;
    }
    
    // 7. Store the step, result, and evaluation
    completedSteps.push({ step: nextStep, result, evaluation });
    
    // 8. Update the enriched message with the latest context
    updateContext(enrichedMessage, strategy, completedSteps);
  }
  
  // Check if we hit the iteration limit
  if (iterations >= maxIterations && !isDone) {
    await sharedEventEmitter.emit('systemStatusMessage', {
      message: `Reached maximum iteration limit of ${maxIterations}.`,
      persistent: true
    });
    
    logger.debug('coordinator', 'Reached maximum iteration limit', { 
      iterations, 
      maxIterations,
      completedSteps: completedSteps.length
    });
  }
  
  return generateResponse(strategy, completedSteps);
}
```

### 4. Update Prompt Templates

Create three new prompt types to support the REACT approach:

1. **Strategic Planning Prompt**
   ```
   Your task is to develop a high-level strategic approach to solving the user's request.
   Do not specify tools or detailed steps, just outline the general approach and define clear success criteria.
   
   USER REQUEST: ${userRequest}
   AVAILABLE TOOLS: ${toolSummary}
   
   ABOUT YOURSELF (Agent Model):
   ${selfModel}
   
   ABOUT THE USER (User Model):
   ${userModel}
   
   SYSTEM CAPABILITIES (Technical Model):
   ${systemModel}
   
   RECENT INTERACTIONS:
   ${recentInteractions}
   
   For simple requests that can be solved in one step, keep your approach straightforward.
   For complex tasks, provide more detailed strategic guidance.
   
   Respond with a JSON object containing:
   - approach: A clear description of the overall strategy that factors in what you know about the user and yourself
   - successCriteria: An array of clear criteria to determine when the task is complete
   - complexityAssessment: A simple assessment (Simple/Moderate/Complex) of the task
   ```

#### Step Planner Prompt

Update the planner prompts to focus on next-step reasoning with strategic context:

```
Given the user's request: "{{original_message}}"
The high-level strategy: {{strategy}}
Success criteria: {{success_criteria}}
And the completed steps so far: {{previous_steps_and_results}}

1. THINK: Reason about the current state of the task relative to our strategy and success criteria.
2. EVALUATE: Assess if we're making progress toward the success criteria.
3. DECIDE: Choose the most appropriate next action or conclude the task is complete.
4. ACT: Specify exactly how to execute this action with the appropriate tool.

Output a single step that makes progress toward completing the user's request while following our strategy.
```

### 5. Implement Result Evaluation Logic

Add a mechanism to evaluate if step results are on track with the strategy:

```javascript
async function evaluateStepResult(result, step, strategy) {
  // Use LLM to evaluate if the step result is:
  // 1. Making progress toward success criteria
  // 2. Aligned with the strategic approach
  // 3. Producing expected outcomes
  
  return {
    isOnTrack: true/false,
    confidence: 0.0-1.0,
    reasoning: "Explanation of evaluation",
    suggestedAdjustments: ["Adjustment 1", "Adjustment 2"]
  };
}
```

### 6. Implement System Integration Points

#### Debug and Subsystem Messages

Emit appropriate debug and subsystem messages at each stage of the REACT process:

```javascript
// In strategic planner
await sharedEventEmitter.emit('subsystemMessage', {
  module: 'planner', // Maintain existing namespace
  content: {
    type: 'strategy',
    strategy: strategy,
    message: enrichedMessage.original_message
  }
});

// In step planner
await sharedEventEmitter.emit('subsystemMessage', {
  module: 'planner',
  content: {
    type: 'step_planning',
    currentStep: currentStep,
    strategy: strategy,
    completedSteps: completedSteps.length
  }
});

// In step evaluator
await sharedEventEmitter.emit('subsystemMessage', {
  module: 'coordinator',
  content: {
    type: 'step_evaluation',
    evaluation: evaluation,
    stepIndex: completedSteps.length
  }
});
```

#### System Status Messages

Emit clear status messages to inform the user about the progress:

```javascript
// Starting strategic planning
await sharedEventEmitter.emit('systemStatusMessage', {
  message: 'Formulating strategic approach...',
  persistent: false
});

// Planning next step
await sharedEventEmitter.emit('systemStatusMessage', {
  message: `Planning step ${completedSteps.length + 1}...`,
  persistent: false
});

// Executing step
await sharedEventEmitter.emit('systemStatusMessage', {
  message: `Executing: ${nextStep.description || nextStep.action}`,
  persistent: false
});

// Evaluating step results
await sharedEventEmitter.emit('systemStatusMessage', {
  message: `Evaluating results...`,
  persistent: false
});
```

#### Model Configuration Settings

Ensure all model calls have appropriate settings with UI configurability:

```javascript
// Strategic planner model settings
const settings = loadSettings();
const strategicResponse = await openai.chat(strategicPrompts, {
  model: settings.strategicPlannerModel || settings.plannerModel || settings.llmModel,
  temperature: settings.strategicPlannerTemperature || 0.7,
  max_tokens: settings.strategicPlannerMaxTokens || 2000
});

// Step planner model settings
const stepResponse = await openai.chat(stepPrompts, {
  model: settings.stepPlannerModel || settings.plannerModel || settings.llmModel,
  temperature: settings.stepPlannerTemperature || 0.7,
  max_tokens: settings.stepPlannerMaxTokens || 1000
});

// Step evaluator model settings
const evaluationResponse = await openai.chat(evaluationPrompts, {
  model: settings.evaluatorModel || settings.llmModel,
  temperature: settings.evaluatorTemperature || 0.3,
  max_tokens: settings.evaluatorMaxTokens || 500
});
```

### 7. Update System Model and Documentation

Revise `src/core/systemModel.md` to reflect the new REACT-style approach with strategic planning. This is critical as the system model is read during strategic planning to inform the agent's understanding of its own capabilities.

The updated system model should include:

```markdown
## Execution Model: Strategy-Guided REACT

The agent employs a strategy-guided REACT (Reason + Act) execution model that combines high-level planning with step-by-step adaptive execution:

1. **Strategic Planning**: Before execution, the agent formulates a high-level approach and success criteria based on:
   - The user's request
   - Available tools
   - Memory models (self, user, system)
   - Previous interactions

2. **Iterative Execution**: Instead of planning the entire solution upfront, the agent:
   - Plans and executes one step at a time
   - Evaluates the result of each step
   - Adapts subsequent steps based on results
   - Continuously checks progress against success criteria

3. **Complexity Handling**: The approach scales based on task complexity:
   - Simple requests may be handled in a single step
   - Complex tasks involve multiple reasoning and action steps
   - An iteration limit prevents infinite loops
```

Also update the README.md file in the root folder to explain the new approach.

## Code Changes Required

### 1. Core Components to Modify

1. **src/core/ego/index.js**:
   - Update `executeWithEvaluation` to integrate strategy formulation before step execution
   - Add methods for context management between steps
   - Implement step evaluation logic
   - Ensure proper subsystem and status messages are emitted

2. **src/core/planner/index.js**:
   - Create new `strategicPlanner` function for high-level approach
   - Rewrite the step planner to generate single steps instead of full plans
   - Add reasoning capability that refers to the strategy
   - Emit appropriate subsystem messages with the 'planner' module namespace
   - Ensure all model calls use configurable settings

3. **src/core/coordinator/index.js**:
   - Maintain the coordinator naming convention
   - Update `coordinator` to implement the REACT execution loop
   - Add evaluation logic for checking progress against success criteria
   - Implement adaptive behavior based on step evaluations
   - Emit subsystem messages with the 'coordinator' module namespace
   - Provide detailed system status messages during execution

4. **src/core/planner/prompts.js**:
   - Create strategic planner prompts
   - Update step planner prompts to include strategy context
   - Add evaluation prompts for checking step results

5. **src/utils/settings.js**:
   - Add new configurable settings for strategic planner, step planner, and evaluator
   - Add `maxREACTIterations` setting with a default of 10
   - Ensure backwards compatibility with existing settings

6. **Front-end components**:
   - Update UI to display strategy and progress against success criteria
   - Add configuration options for new model settings

### 2. Implementation Order

1. Create unit tests for the new strategy-guided REACT execution
2. Implement the strategic planner for high-level approach
3. Develop the single-step planner with strategy awareness
4. Create the step evaluation mechanism
5. Implement the REACT-style coordinator loop
6. Update the prompt structures
7. Implement system integration points (debug messages, status updates, model settings)
8. Integrate with the existing ego system
9. Add fallback mechanisms for error handling
10. Update documentation (README.md and systemModel.md)

## Benefits of the Strategy-Guided REACT Approach

1. **Strategic Direction**: High-level approach provides guidance without rigid planning
2. **Increased Adaptability**: Each step is planned with the most up-to-date context
3. **Progress Tracking**: Clear success criteria to measure advancement
4. **Improved Error Handling**: Errors are detected and evaluated immediately after each step
5. **Better Resource Utilization**: Smaller, focused planning prompts instead of large comprehensive ones
6. **Enhanced Transparency**: Clear reasoning trail and strategy alignment for each action
7. **Dynamic Course Correction**: Step evaluations provide feedback for course adjustments

## Potential Challenges

1. **Token Consumption**: Sending full history with each planning step could increase token usage
   - Mitigation: Implement simple step storage initially, then add smart summarization if needed
   
2. **Task Loops**: Without proper constraints, the agent might loop infinitely
   - Mitigation: Implement a hard iteration limit (default 10, configurable in settings)
   
3. **Strategic Drift**: Individual steps might optimize locally but drift from overall strategy
   - Mitigation: Regular evaluation of alignment with strategic goals

4. **Success Criteria Clarity**: Descriptive criteria may be harder to evaluate programmatically
   - Mitigation: Careful prompt engineering for the evaluator to assess descriptive criteria
   
5. **Regression Testing**: Ensuring the new implementation maintains overall functionality
   - Mitigation: Regular validation using `npm run query` with standard test queries

## Next Steps

1. Create a prototype of the strategy-guided REACT execution in a separate branch
2. Implement the complete solution in one cohesive implementation
3. Run regression tests using `npm run query "what is the native bird of india"` to validate high-level functionality
4. Define additional test cases that specifically challenge adaptive reasoning capabilities
5. Verify all debug/subsystem messages are correctly emitted and useful for debugging
6. Confirm system status messages provide a clear picture of execution progress
7. Test UI configuration of model settings and parameter adjustments
8. Benchmark token usage and execution time
9. Refine the evaluation mechanisms based on test results
10. Update system documentation (README.md and systemModel.md) to reflect the new mental model
