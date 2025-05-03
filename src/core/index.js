/**
 * Core modules for the LLM Agent
 */

const memory = require('./memory');
const { planner } = require('./planner');
const Ego = require('./ego');
const { coordinator } = require('./coordinator');
const { evaluator } = require('./evaluator');

module.exports = {
  memory,
  planner,
  Ego,
  coordinator,
  evaluator
};
