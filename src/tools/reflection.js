const logger = require('../utils/logger');
const memory = require('../core/memory');
const path = require('path');
const fs = require('fs');
const { getOpenAIClient } = require('../utils/openaiClient');
const { loadSettings } = require('../utils/settings');
const sharedEventEmitter = require('../utils/eventEmitter');

/**
 * MemoryWriterTool - Lightweight tool for storing reflections and learnings in memory
 * Consolidates functionality from the reflection process
 */
class ReflectionTool {
    constructor() {
        this.name = 'reflection';
        this.description = 'Tool for storing important learnings and reflections in long-term memory';
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'storeReflection',
                    description: 'Store important insights and reflections from recent interactions',
                    parameters: [
                        { name: 'insight', description: 'The insight to store', type: 'string', required: true },
                        { name: 'category', description: 'Category for organization', type: 'string', required: false },
                        { name: 'importance', description: 'Importance rating (1-5)', type: 'number', required: false }
                    ]
                },
                {
                    name: 'storeLesson',
                    description: 'Store lessons learned from interactions',
                    parameters: [
                        { name: 'lesson', description: 'The lesson learned', type: 'string', required: true },
                        { name: 'application', description: 'How this lesson can be applied', type: 'string', required: false }
                    ]
                },
                {
                    name: 'quickReflect',
                    description: 'Perform a lightweight reflection on recent interactions',
                    parameters: [
                        { name: 'useSystemModel', description: 'Whether to use system model context', type: 'boolean', required: false },
                        { name: 'useSelfModel', description: 'Whether to use self model context', type: 'boolean', required: false }
                    ]
                }
            ]
        };
    }

    /**
     * Store an insight in long-term memory
     * @param {Array} params - Parameters for the action
     * @returns {Promise<Object>} - Result of the operation
     */
    async storeReflection(params) {
        try {
            const insightParam = params.find(p => p.name === 'insight');
            const categoryParam = params.find(p => p.name === 'category');
            const importanceParam = params.find(p => p.name === 'importance');

            if (!insightParam || !insightParam.value) {
                return { status: 'error', error: 'Missing required parameter: insight' };
            }

            const insight = insightParam.value;
            const category = categoryParam?.value || 'General';
            const importance = importanceParam?.value || 3;

            logger.debug('MemoryWriterTool', 'Storing insight in long-term memory', { 
                category,
                insight: insight.substring(0, 50) + (insight.length > 50 ? '...' : ''),
                importance
            });

            const formattedInsight = `[Insight] ${category}: ${insight}`;
            const result = await memory.storeLongTerm(formattedInsight);

            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'memoryWriter',
                content: { 
                    type: 'insight_stored',
                    category,
                    importance,
                    timestamp: new Date().toISOString()
                }
            });

            return { 
                status: 'success', 
                message: 'Insight stored in long-term memory',
                result
            };
        } catch (error) {
            logger.error('MemoryWriterTool', 'Error storing insight', {
                error: error.message,
                stack: error.stack
            });
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Store a lesson learned in long-term memory
     * @param {Array} params - Parameters for the action
     * @returns {Promise<Object>} - Result of the operation
     */
    async storeLesson(params) {
        try {
            const lessonParam = params.find(p => p.name === 'lesson');
            const applicationParam = params.find(p => p.name === 'application');

            if (!lessonParam || !lessonParam.value) {
                return { status: 'error', error: 'Missing required parameter: lesson' };
            }

            const lesson = lessonParam.value;
            const application = applicationParam?.value || '';

            logger.debug('MemoryWriterTool', 'Storing lesson in long-term memory', { 
                lesson: lesson.substring(0, 50) + (lesson.length > 50 ? '...' : ''),
                application: application.substring(0, 50) + (application.length > 50 ? '...' : '')
            });

            const formattedLesson = application 
                ? `[Lesson] ${lesson} - Application: ${application}`
                : `[Lesson] ${lesson}`;
                
            const result = await memory.storeLongTerm(formattedLesson);

            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'memoryWriter',
                content: { 
                    type: 'lesson_stored',
                    timestamp: new Date().toISOString()
                }
            });

            return { 
                status: 'success', 
                message: 'Lesson stored in long-term memory',
                result
            };
        } catch (error) {
            logger.error('MemoryWriterTool', 'Error storing lesson', {
                error: error.message,
                stack: error.stack
            });
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Perform a lightweight reflection on recent interactions
     * @param {Array} params - Parameters for the action
     * @returns {Promise<Object>} - Result of the operation
     */
    async quickReflect(params) {
        try {
            const useSystemModelParam = params.find(p => p.name === 'useSystemModel');
            const useSelfModelParam = params.find(p => p.name === 'useSelfModel');

            const useSystemModel = useSystemModelParam?.value !== false;
            const useSelfModel = useSelfModelParam?.value !== false;

            logger.debug('MemoryWriterTool', 'Starting quick reflection process', {
                useSystemModel,
                useSelfModel
            });

            const shortTermMemory = await memory.retrieveShortTerm();
            
            // Load models if requested
            let selfModel = '';
            let systemModel = '';
            
            if (useSelfModel) {
                try {
                    const selfModelPath = path.join(process.cwd(), 'data', 'self', 'models', 'self.md');
                    if (fs.existsSync(selfModelPath)) {
                        selfModel = fs.readFileSync(selfModelPath, 'utf-8');
                        logger.debug('MemoryWriterTool', 'Successfully loaded self model file');
                    }
                } catch (fileError) {
                    logger.error('MemoryWriterTool', 'Error reading self model file', {
                        error: fileError.message
                    });
                }
            }
            
            if (useSystemModel) {
                try {
                    const systemModelPath = path.join(__dirname, '..', 'core', 'systemModel.md');
                    if (fs.existsSync(systemModelPath)) {
                        systemModel = fs.readFileSync(systemModelPath, 'utf-8');
                        logger.debug('MemoryWriterTool', 'Successfully loaded system model file');
                    }
                } catch (fileError) {
                    logger.error('MemoryWriterTool', 'Error reading system model file', {
                        error: fileError.message
                    });
                }
            }

            // Simplified reflection prompt
            const systemPrompt = `You are a reflection assistant that identifies key insights and lessons from recent interactions.
Your task is to analyze the provided conversation history and extract:
1. Important insights about the user or the conversation
2. Lessons that could be applied in future interactions
3. Any notable patterns or preferences

${useSystemModel ? 'Consider this system model information: ' + systemModel : ''}
${useSelfModel ? 'Consider this self model information: ' + selfModel : ''}

Respond with a JSON object containing:
{
  "insights": [
    {"category": "string", "description": "string", "importance": number}
  ],
  "lessons_learned": [
    {"lesson": "string", "application": "string"}
  ]
}`;

            const userPrompt = `Here is the recent conversation history to analyze:
${shortTermMemory || 'No recent conversation history available.'}

Extract key insights and lessons from this conversation.`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            const settings = loadSettings();
            const openai = getOpenAIClient();
            const response = await openai.chat(messages, {
                model: settings.reflectionModel || settings.llmModel,
                response_format: { type: "json_object" },
                temperature: 0.7,
                max_tokens: 1000
            });

            let reflectionResults;
            try {
                reflectionResults = JSON.parse(response.content);
            } catch (parseError) {
                logger.error('MemoryWriterTool', 'Failed to parse reflection response', {
                    error: parseError.message,
                    content: response.content
                });
                return { status: 'error', error: 'Failed to parse reflection response' };
            }

            // Process and store insights and lessons
            let storedCount = 0;
            
            if (reflectionResults.insights && Array.isArray(reflectionResults.insights)) {
                for (const insight of reflectionResults.insights) {
                    if (insight && insight.description) {
                        try {
                            await memory.storeLongTerm(`[Insight] ${insight.category || 'General'}: ${insight.description}`);
                            storedCount++;
                        } catch (error) {
                            logger.error('MemoryWriterTool', 'Error storing insight', { error: error.message });
                        }
                    }
                }
            }
            
            if (reflectionResults.lessons_learned && Array.isArray(reflectionResults.lessons_learned)) {
                for (const lesson of reflectionResults.lessons_learned) {
                    if (lesson && lesson.lesson) {
                        try {
                            const formattedLesson = lesson.application
                                ? `[Lesson] ${lesson.lesson} - Application: ${lesson.application}`
                                : `[Lesson] ${lesson.lesson}`;
                            await memory.storeLongTerm(formattedLesson);
                            storedCount++;
                        } catch (error) {
                            logger.error('MemoryWriterTool', 'Error storing lesson', { error: error.message });
                        }
                    }
                }
            }

            await sharedEventEmitter.emit('subsystemMessage', {
                module: 'memoryWriter',
                content: { 
                    type: 'quick_reflection_complete',
                    insightsCount: reflectionResults.insights?.length || 0,
                    lessonsCount: reflectionResults.lessons_learned?.length || 0,
                    storedCount,
                    timestamp: new Date().toISOString()
                }
            });

            return {
                status: 'success',
                message: `Quick reflection complete. Stored ${storedCount} items in long-term memory.`,
                insightsCount: reflectionResults.insights?.length || 0,
                lessonsCount: reflectionResults.lessons_learned?.length || 0
            };
        } catch (error) {
            logger.error('MemoryWriterTool', 'Error during quick reflection', {
                error: error.message,
                stack: error.stack
            });
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Execute a tool action with parameters
     * @param {string} action - The action to execute
     * @param {Array|string|Object} parameters - Parameters for the action
     * @returns {Promise<Object>} - Result of the operation
     */
    async execute(action, parameters) {
        let parsed = parameters;
        if (typeof parameters === 'string') {
            try {
                parsed = JSON.parse(parameters);
            } catch (e) {
                return { status: 'error', error: 'Invalid parameters JSON' };
            }
        }

        if (!Array.isArray(parsed)) {
            parsed = Object.entries(parsed || {}).map(([name, value]) => ({ name, value }));
        }

        switch (action) {
            case 'storeReflection':
                return await this.storeReflection(parsed);
            case 'storeLesson':
                return await this.storeLesson(parsed);
            case 'quickReflect':
                return await this.quickReflect(parsed);
            default:
                return { status: 'error', error: `Unknown action: ${action}` };
        }
    }
}

module.exports = new ReflectionTool();
