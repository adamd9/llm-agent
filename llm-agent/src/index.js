const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Ego = require('./ego');
const { coordinator } = require('./coordinator');
const path = require('path');

// Debug logging function
const debug = (context, message, data = {}) => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        context,
        message,
        ...data
    }, null, 2));
};

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Store sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Initialize ego instance
const ego = new Ego('R2O1', ['conversation', 'file-system']);

// Start the server only if this file is run directly
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        debug('server', `Server running on port ${port}`);
    });
}

// Chat endpoint
app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            debug('chat', 'Missing message in request', { body: req.body });
            return res.status(400).json({ 
                error: 'Message is required',
                details: {
                    timestamp: new Date().toISOString(),
                    requestBody: req.body
                }
            });
        }

        // Get or create session ID
        let sessionId = req.headers['session-id'];
        if (!sessionId) {
            sessionId = uuidv4();
            debug('chat', 'Created new session', { sessionId });
        }

        // Get session history
        let sessionHistory = sessions.get(sessionId) || [];
        debug('chat', 'Retrieved session history', { 
            sessionId, 
            historyLength: sessionHistory.length,
            history: sessionHistory 
        });

        // Process message through ego
        debug('chat', 'Sending message to ego', { message, sessionId });
        const egoResponse = await ego.processMessage(message, sessionHistory);
        debug('chat', 'Received response from ego', { 
            sessionId,
            response: egoResponse 
        });

        let response;
        if (egoResponse.type === 'error') {
            // Handle error response
            debug('chat', 'Error from ego', { 
                sessionId,
                error: egoResponse.error 
            });
            return res.status(500).json({
                error: 'Processing error',
                details: egoResponse.error
            });
        } else if (egoResponse.type === 'task') {
            // If ego detected a task, send it to the coordinator
            try {
                debug('chat', 'Sending task to coordinator', {
                    sessionId,
                    task: egoResponse.enriched_message
                });
                const result = await coordinator(egoResponse.enriched_message);
                debug('chat', 'Received response from coordinator', {
                    sessionId,
                    result
                });

                // Check for errors in the result
                if (result.status === 'error') {
                    debug('chat', 'Error from coordinator result', {
                        sessionId,
                        error: result.error
                    });
                    return res.status(500).json({
                        error: result.error,
                        details: result.details || {},
                        timestamp: new Date().toISOString()
                    });
                }

                // Check for failed actions in the response if it exists
                if (result.response) {
                    const failedSteps = result.response.match(/Failed actions:\n([^]*?)(?=\n\n|$)/);
                    if (failedSteps) {
                        debug('chat', 'Found failed actions', {
                            sessionId,
                            failedSteps: failedSteps[1]
                        });
                        return res.status(500).json({
                            error: 'Task execution error',
                            details: {
                                message: failedSteps[1],
                                fullResponse: result.response,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                }

                response = result.response || egoResponse.response;
            } catch (coordError) {
                debug('chat', 'Error from coordinator', {
                    sessionId,
                    error: coordError.message,
                    stack: coordError.stack,
                    details: coordError.details
                });
                return res.status(500).json({
                    error: coordError.message || 'Task execution error',
                    stack: coordError.stack,
                    details: {
                        error: coordError.message,
                        stack: coordError.stack,
                        details: coordError.details,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        } else {
            // For conversation, use ego's response directly
            response = egoResponse.response;
        }

        // Update session history
        sessionHistory = [
            ...sessionHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: response }
        ].slice(-10); // Keep last 10 messages
        sessions.set(sessionId, sessionHistory);

        debug('chat', 'Updated session history', {
            sessionId,
            newHistoryLength: sessionHistory.length
        });

        res.json({
            message: response,
            sessionId,
            debug: {
                timestamp: new Date().toISOString(),
                sessionHistoryLength: sessionHistory.length,
                messageType: egoResponse.type
            }
        });
    } catch (error) {
        debug('chat', 'Unhandled error in chat endpoint', {
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        res.status(500).json({
            error: 'Internal server error',
            details: {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// Session history endpoint
app.get('/chat/:sessionId/history', (req, res) => {
    const { sessionId } = req.params;
    const history = sessions.get(sessionId) || [];
    debug('history', 'Retrieved session history', {
        sessionId,
        historyLength: history.length
    });
    res.json(history);
});

module.exports = app;
