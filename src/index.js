const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Ego = require("./ego");
const WebSocket = require("ws");
const http = require("http");
const logger = require("./utils/logger");
const sharedEventEmitter = require("./utils/eventEmitter");
const memory = require('./memory');
const cliLogger = require('./utils/cliLogger');
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
const ego = new Ego(["llmquery", "file-system"]);

async function processInitialMessage() {
    if (!initialMessage) return;
    
    logger.debug("initial-message", "Processing initial message", { message: initialMessage });
    try {
        // Create a temporary session for the initial message
        const tempSessionId = `cli_${uuidv4()}`;
        const sessionHistory = [];
        
        // Initialize CLI logger
        cliLogger.initialize(tempSessionId);
        
        // Create promise to track message completion
        let messagePromise = new Promise((resolve) => {
            const messages = [];
            
            // Set up event listeners for CLI mode
            const cliEventListeners = {
                assistantResponse: async (data) => {
                    await cliLogger.logMessage("response", { response: data });
                    messages.push({ type: "response", data });
                    // Resolve after getting the main response
                    resolve(messages);
                },
                assistantWorking: async (data) => {
                    await cliLogger.logMessage("working", { status: data });
                    messages.push({ type: "working", data });
                },
                debugResponse: async (data) => {
                    await cliLogger.logMessage("debug", data);
                    messages.push({ type: "debug", data });
                }
            };

            // Register CLI event listeners
            Object.entries(cliEventListeners).forEach(([event, listener]) => {
                sharedEventEmitter.on(event, listener);
            });
            
            // Process the message
            ego.processMessage(initialMessage, sessionHistory).catch((error) => {
                logger.error("initial-message", "Error in message processing", error);
                resolve(messages); // Resolve even on error to ensure cleanup
            });
        });

        // Wait for message processing to complete
        const messages = await messagePromise;
        
        // Give a small delay to ensure all async operations complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Log final message location if we got any messages
        if (messages.length > 0) {
            console.log(`\nSession output saved to: ${cliLogger.outputPath}`);
        }
        
        process.exit(0);
    } catch (error) {
        logger.error("initial-message", "Error processing initial message", error);
        process.exit(1);
    }
}

async function startServer() {
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
    const messageQueue = [];
    let isSending = false;

    // Function to process the message queue
    async function processQueue(ws) {
        if (isSending || messageQueue.length === 0) return;
        isSending = true;

        while (messageQueue.length > 0) {
            const { type, data } = messageQueue.shift();
            ws.send(JSON.stringify({ type, data }));      
        }
        isSending = false;
    }

    // WebSocket connection handler
    wss.on("connection", (ws) => {
        let sessionId = uuidv4();
        wsConnections.set(sessionId, ws);
        memory.resetMemory();
        logger.debug("websocket", "New WebSocket connection", { sessionId });

        // Initialize CLI logger for this session
        cliLogger.initialize(sessionId);

        // Send session ID to client
        ws.send(JSON.stringify({ type: "session", sessionId }));

        ws.on("message", async (message) => {
            try {
                const data = JSON.parse(message);
                logger.debug("websocket", "Received message", { sessionId, data });

                // Get session history
                let sessionHistory = sessions.get(sessionId) || [];

                // Process message through ego
                await ego.processMessage(data.message, sessionHistory);

            } catch (error) {
                logger.debug("websocket", "Error processing message", {
                    sessionId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                    },
                });
                ws.send(
                    JSON.stringify({
                        type: "error",
                        error: "Internal server error",
                        details: {
                            message: error.message,
                            timestamp: new Date().toISOString(),
                        },
                    })
                );
                // Log error to file
                await cliLogger.logMessage("error", {
                    error: "Internal server error",
                    details: {
                        message: error.message,
                        timestamp: new Date().toISOString(),
                    }
                });
            }
        });

        ws.on("close", () => {
            logger.debug("websocket", "Connection closed", { sessionId });
            wsConnections.delete(sessionId);
        });

        sharedEventEmitter.on("assistantResponse", async (data) => {
            messageQueue.push({ type: "response", data: { response: data } });
            processQueue(ws);

            let sessionHistory = sessions.get(sessionId) || [];
            sessionHistory.push({
                role: "assistant",
                content: data,
            });
            sessions.set(sessionId, sessionHistory);

            // Log response to file
            await cliLogger.logMessage("response", { response: data });
        });

        sharedEventEmitter.on("assistantWorking", async (data) => {
            messageQueue.push({ type: "working", data: { status: data } });
            processQueue(ws);

            // Log working status to file
            await cliLogger.logMessage("working", { status: data });
        });

        sharedEventEmitter.on("debugResponse", async (data) => {
            messageQueue.push({ type: "debug", data });
            processQueue(ws);

            let sessionHistory = sessions.get(sessionId) || [];
            sessionHistory.push({
                role: "assistantDebug",
                content: data,
            });
            sessions.set(sessionId, sessionHistory);

            // Log debug message to file
            await cliLogger.logMessage("debug", data);
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
