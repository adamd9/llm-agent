// Test script for planner memory handling
const planner = require('./src/core/planner');
const logger = require('./src/utils/logger');

async function testPlannerMemory() {
  console.log('Testing planner memory handling...');
  
  // Create a test message with object memories
  const testMessage = {
    original_message: "What is the weather?",
    context: {
      short_term_memory: {
        key1: "value1",
        key2: "value2",
        nested: {
          key3: "value3"
        }
      },
      long_term_relevant_memory: {
        memory1: "This is memory 1",
        memory2: "This is memory 2",
        nested: {
          memory3: "This is memory 3"
        }
      }
    }
  };
  
  try {
    // Call the planner with the test message
    console.log('\n1. Calling planner with object memories...');
    const plan = await planner.planner(testMessage);
    
    console.log('\n2. Plan generated successfully');
    console.log('Number of steps in plan:', plan.length);
    
    // Print the first step of the plan
    if (plan && plan.length > 0) {
      console.log('\nFirst step of the plan:');
      console.log(JSON.stringify(plan[0], null, 2));
    }
    
    console.log('\nPlanner memory test completed successfully!');
  } catch (error) {
    console.error('\nError during planner test:', error);
  }
}

// Run the test
testPlannerMemory().catch(err => {
  console.error('Test failed:', err);
});
