const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Ego = require('./ego');
const { coordinator } = require('./coordinator');
const path = require('path');

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
        console.log(`Server running on port ${port}`);
    });
}

// Chat endpoint
app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
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
            console.log('Created new session:', sessionId);
        }

        // Get session history
        let sessionHistory = sessions.get(sessionId) || [];
        console.log(`Processing message for session ${sessionId}, history length: ${sessionHistory.length}`);

        // Process message through ego
        const egoResponse = await ego.processMessage(message, sessionHistory);
        console.log('Ego response:', JSON.stringify(egoResponse, null, 2));

        let response;
        if (egoResponse.type === 'error') {
            // Handle error response
            return res.status(500).json({
                error: 'Processing error',
                details: egoResponse.error
            });
        } else if (egoResponse.type === 'task') {
            // If ego detected a task, send it to the coordinator
            try {
                const result = await coordinator(egoResponse.enriched_message);
                response = result.response || egoResponse.response;
            } catch (coordError) {
                console.error('Coordinator error:', coordError);
                return res.status(500).json({
                    error: 'Task execution error',
                    details: {
                        message: coordError.message,
                        stack: coordError.stack,
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

        console.log(`Updated session ${sessionId}, new history length: ${sessionHistory.length}`);

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
        console.error('Error in chat endpoint:', error);
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
    res.json(history);
});

module.exports = app;
