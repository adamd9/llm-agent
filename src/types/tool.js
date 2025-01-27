/**
 * @typedef {Object} ToolParameter
 * @property {string} name - Parameter name
 * @property {string} description - Parameter description
 * @property {('string'|'number'|'boolean'|'array'|'object')} type - Parameter type
 * @property {boolean} required - Whether the parameter is required
 */

/**
 * @typedef {Object} ToolAction
 * @property {string} name - Action name
 * @property {string} description - Action description
 * @property {ToolParameter[]} parameters - Action parameters
 */

/**
 * @typedef {Object} ToolCapabilities
 * @property {string} name - Tool name
 * @property {string} description - Tool description
 * @property {ToolAction[]} actions - Available actions
 */

/**
 * @typedef {Object} ToolResponse
 * @property {('success'|'error')} status - Response status
 * @property {string} [message] - Optional success message
 * @property {string} [error] - Optional error message
 * @property {*} [data] - Optional response data
 */

/**
 * @typedef {Object} Tool
 * @property {string} name - Tool name
 * @property {string} description - Tool description
 * @property {function(): ToolCapabilities} getCapabilities - Get tool capabilities
 * @property {function(string, any[]): Promise<ToolResponse>} execute - Execute tool action
 */

module.exports = {};  // Empty export to satisfy Node.js module system
