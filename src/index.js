const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Ego = require('./ego');
const { coordinator } = require('./coordinator');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const logger = require('./logger');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Store sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Store WebSocket connections by session ID
const wsConnections = new Map();

// Set WebSocket connections in logger
logger.setWSConnections(wsConnections);

// Initialize ego instance
const ego = new Ego('r2o1', ['conversation', 'file-system']);

async function startServer() {
    await ego.initialize();
    // Create HTTP server instance
    const server = http.createServer(app);

    // Create WebSocket server
    const wss = new WebSocket.Server({ server });

    // WebSocket connection handler
    wss.on('connection', (ws) => {
        let sessionId = uuidv4();
        wsConnections.set(sessionId, ws);

        logger.debug('websocket', 'New WebSocket connection', { sessionId });

        // Send session ID to client
        ws.send(JSON.stringify({ type: 'session', sessionId }));

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                logger.debug('websocket', 'Received message', { sessionId, data });

                // Get session history
                let sessionHistory = sessions.get(sessionId) || [];

                // Process message through ego
                const egoResponse = await ego.processMessage(data.message, sessionHistory);

                // Send response to client
                ws.send(JSON.stringify({
                    type: 'response',
                    data: egoResponse
                }));

                // Update session history
                sessionHistory.push({
                    role: 'user',
                    content: data.message
                });
                sessionHistory.push({
                    role: 'assistant',
                    content: egoResponse.response || egoResponse.error
                });
                sessions.set(sessionId, sessionHistory);

            } catch (error) {
                logger.debug('websocket', 'Error processing message', {
                    sessionId,
                    error: {
                        message: error.message,
                        stack: error.stack
                    }
                });
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Internal server error',
                    details: {
                        message: error.message,
                        timestamp: new Date().toISOString()
                    }
                }));
            }
        });

        ws.on('close', () => {
            logger.debug('websocket', 'Connection closed', { sessionId });
            wsConnections.delete(sessionId);
        });
    });

    // Session history endpoint
    app.get('/chat/:sessionId/history', (req, res) => {
        const { sessionId } = req.params;
        const history = sessions.get(sessionId) || [];
        res.json(history);
    });

    // Start the server only if this file is run directly
    if (require.main === module) {
        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.debug('server', `Server running on port ${port}`);
        });
    }
}

startServer();

module.exports = { app };
