// Triggering nodemon restart
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const core = require('./core');
const WebSocket = require("ws");
const http = require("http");
const logger = require("./utils/logger");
const sharedEventEmitter = require("./utils/eventEmitter");
const safeStringify = require('./utils/safeStringify');
const app = express();
app.use(express.json());
app.use(express.static("public"));

// Store sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Store WebSocket connections by session ID
const wsConnections = new Map();

// Set WebSocket connections in logger
logger.setWSConnections(wsConnections);

// Get initial message from command line args
const initialMessage = process.argv[2];

// Initialize ego instance
const ego = new core.Ego(["llmquery", "file-system"]);

async function processInitialMessage() {
    if (!initialMessage) return;
    
    logger.debug("initial-message", "Processing initial message", { message: initialMessage });
    try {
        // Create a temporary session for the initial message
        const tempSessionId = `cli_${uuidv4()}`;
        const sessionHistory = [];
        
        // Initialize logger for this session
        await logger.initialize(tempSessionId);
        
        // Create promise to track message completion
        let messagePromise = new Promise((resolve) => {
            const messages = [];
            
            // Listen for debug responses
            const debugHandler = async (data) => {
                messages.push(data);
            };
            
            // Listen for completion
            const completionHandler = () => {
                sharedEventEmitter.off('debugResponse', debugHandler);
                sharedEventEmitter.off('assistantComplete', completionHandler);
                resolve(messages);
            };
            
            sharedEventEmitter.on('debugResponse', debugHandler);
            sharedEventEmitter.on('assistantComplete', completionHandler);
            
            // Process the message
            ego.processMessage(initialMessage, sessionHistory);
        });

        // Wait for message processing to complete
        const messages = await messagePromise;
        
        // Give a small delay to ensure all async operations complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Log final message location if we got any messages
        if (messages.length > 0) {
            logger.debug(`\nSession output saved to: ${logger.outputPath}`);
        }
        
        process.exit(0);
    } catch (error) {
        logger.error("initial-message", "Error processing initial message", error);
        process.exit(1);
    }
}

async function startServer() {
    // Initialize tool manager first
    const toolManager = require('./mcp');
    await toolManager.initialize();
    
    // Then initialize ego
    await ego.initialize();
    
    // If there's an initial message, process it and exit
    if (initialMessage) {
        await processInitialMessage();
        return;
    }
    
    // Otherwise start the server normally
    const server = http.createServer(app);

    // Create WebSocket server
    const wss = new WebSocket.Server({ server });

    // Message queue to hold messages to be sent
    const messageQueue = new Map(); 

    // Function to process the message queue
    async function processQueue(ws) {
        const sessionId = ws.sessionId;
        const queue = messageQueue.get(sessionId);
        if (!queue || queue.length === 0) return;

        const message = queue.shift();
        if (!message) return;

        try {
            await new Promise((resolve, reject) => {
                ws.send(safeStringify(message, 'processQueue'), (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            
            // Process next message if any
            if (queue.length > 0) {
                setTimeout(() => processQueue(ws), 10); 
            }
        } catch (error) {
            logger.error('websocket', 'Error sending message', { error, message });
        }
    }

    // Handle WebSocket connections
    wss.on('connection', async (ws) => {
        const sessionId = uuidv4();
        const isNewSession = !sessions.has(sessionId);
        
        // Initialize logger for this session
        await logger.initialize(sessionId);
        
        sessions.set(sessionId, []);
        wsConnections.set(sessionId, ws);
        ws.sessionId = sessionId;
        messageQueue.set(sessionId, []); 
        
        // Only reset memory for new sessions, not reconnections
        if (isNewSession) {
            await core.memory.resetMemory();
        }

        // Send initial connection message
        ws.send(safeStringify({
            type: 'connected',
            sessionId,
            isNewSession
        }, 'websocket.connection'));

        logger.debug('websocket', 'New WebSocket connection', { sessionId, isNewSession });

        ws.on("message", async (message) => {
            try {
                const data = JSON.parse(message);
                logger.debug("websocket", "Received message", { sessionId: ws.sessionId, data });

                // Get session history
                let sessionHistory = sessions.get(ws.sessionId) || [];

                // Process message through ego
                await ego.processMessage(data.message, sessionHistory);
            } catch (error) {
                logger.error("websocket", "Error processing message", {
                    sessionId: ws.sessionId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                    },
                });

                ws.send(
                    JSON.stringify({
                        type: "error",
                        error: {
                            message: error.message,
                            timestamp: new Date().toISOString(),
                        },
                    })
                );
            }
        });

        ws.on("close", () => {
            logger.debug("websocket", "Connection closed", { sessionId: ws.sessionId });
            wsConnections.delete(ws.sessionId);
            messageQueue.delete(ws.sessionId); 
            sessions.delete(ws.sessionId);
        });

        sharedEventEmitter.on("assistantResponse", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "response", 
                    data: { response: data }  
                });
                processQueue(ws);
            }

            let sessionHistory = sessions.get(ws.sessionId) || [];
            sessionHistory.push({
                role: "assistant",
                content: data,
            });
            sessions.set(ws.sessionId, sessionHistory);

            // Log response to file
            await logger.debug("response", "Assistant response", { response: data });
        });

        sharedEventEmitter.on("systemStatusMessage", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "working", 
                    data: { status: data }  
                });
                processQueue(ws);
            }

            // Log working status to file
            await logger.debug("working", "Assistant working", { status: data });
        });

        sharedEventEmitter.on("subsystemMessage", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "subsystem", 
                    data: { 
                        module: data.module,
                        content: data.content 
                    }  
                });
                processQueue(ws);
            }

            // Log subsystem message to file
            await logger.debug("subsystem", `${data.module} subsystem message`, { 
                module: data.module,
                content: data.content 
            });
        });

        sharedEventEmitter.on("systemError", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({ 
                    type: "systemError", 
                    data: { 
                        module: data.module,
                        content: data.content 
                    }  
                });
                processQueue(ws);
            }

            // Log system error to file
            await logger.error("systemError", `${data.module} system error`, { 
                module: data.module,
                content: data.content 
            });
        });

        sharedEventEmitter.on("debugResponse", async (data) => {
            const queue = messageQueue.get(ws.sessionId);
            if (queue) {
                queue.push({
                    type: "debug",
                    data: data  
                });
                processQueue(ws);
            }

            let sessionHistory = sessions.get(ws.sessionId) || [];
            sessionHistory.push({
                role: "assistantDebug",
                content: data,
            });
            sessions.set(ws.sessionId, sessionHistory);
        });
    });

    // Session history endpoint
    app.get("/chat/:sessionId/history", (req, res) => {
        const { sessionId } = req.params;
        const history = sessions.get(sessionId) || [];
        res.json(history);
    });

    // Start the server only if this file is run directly
    if (require.main === module) {
        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.debug("server", `Server running on port ${port}`);
        });
    }
}

startServer();

module.exports = { app };
