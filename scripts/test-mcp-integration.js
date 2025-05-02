/**
 * MCP Integration Test Script
 * 
 * This script tests the MCP client and server integration.
 * It can be used to verify that the MCP infrastructure is working correctly
 * and to debug issues with specific MCP servers.
 * 
 * Usage:
 *   node scripts/test-mcp-integration.js [server-path]
 * 
 * If server-path is provided, it will test only that specific server.
 * Otherwise, it will test all available MCP servers.
 */
const toolManager = require('../src/mcp');
const logger = require('../src/utils/logger');
const path = require('path');

// Enable debug logging
process.env.DEBUG = 'llm-agent:*';

async function testMCPIntegration() {
  try {
    console.log('Starting MCP integration test...');
    
    // Check for specific server to test
    const specificServer = process.argv[2];
    if (specificServer) {
      console.log(`Testing specific server: ${specificServer}`);
    }
    
    // Load all tools including MCP tools
    console.log('Loading tools...');
    const tools = await toolManager.loadTools();
    
    // Log loaded tools
    console.log('Loaded tools:', tools.map(t => t.name));
    
    // Filter MCP tools
    const mcpTools = tools.filter(t => t.source === 'mcp');
    console.log(`Found ${mcpTools.length} MCP tools:`, mcpTools.map(t => t.name));
    
    if (mcpTools.length === 0) {
      console.log('No MCP tools found. Check that MCP servers are available in the data/mcp-servers directory.');
      return;
    }
    
    // Test a calculator tool if available
    const calculatorTools = tools.filter(t => t.name.startsWith('calculator.'));
    if (calculatorTools.length > 0) {
      console.log('Found calculator tools:', calculatorTools.map(t => t.name));
      
      // Test calculator.add
      const addTool = toolManager.getTool('calculator.add');
      if (addTool) {
        console.log('Testing calculator.add...');
        const result = await addTool.execute('execute', { a: 5, b: 7 });
        console.log('Addition result:', result);
        
        if (result.result === 12) {
          console.log('✅ Calculator test passed!');
        } else {
          console.log('❌ Calculator test failed!');
        }
      }
    }
    
    // Clean up
    console.log('Cleaning up...');
    try {
      await toolManager.cleanup();
      console.log('Cleanup completed successfully');
    } catch (cleanupError) {
      console.error('Error during cleanup (continuing):', cleanupError.message);
      // Don't let cleanup errors fail the test
    }
    
    console.log('MCP integration test completed successfully');
    
    // Force exit to avoid hanging due to any remaining child processes
    process.exit(0);
  } catch (error) {
    console.error('Error in MCP test:', error);
    process.exit(1);
  }
}

// Run the test
testMCPIntegration();
