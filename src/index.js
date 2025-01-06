const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Ego = require("./ego");
const WebSocket = require("ws");
const http = require("http");
const logger = require("./logger");
const sharedEventEmitter = require("./eventEmitter");
const { stringify } = require('flatted');
const memory = require('./memory');
const app = express();
app.use(express.json());
app.use(express.static("public"));

// Store sessions in memory (replace with proper storage in production)
const sessions = new Map();

// Store WebSocket connections by session ID
const wsConnections = new Map();

// Set WebSocket connections in logger
logger.setWSConnections(wsConnections);

// Initialize ego instance
const ego = new Ego("r2o1", ["conversation", "file-system"]);

async function startServer() {
  await ego.initialize();
  // Create HTTP server instance
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
      await memory.storeShortTerm('Assistant response', data);
    }
    isSending = false;
  }

  // WebSocket connection handler
  wss.on("connection", (ws) => {
    let sessionId = uuidv4();
    wsConnections.set(sessionId, ws);

    logger.debug("websocket", "New WebSocket connection", { sessionId });

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
      }
    });

    ws.on("close", () => {
      logger.debug("websocket", "Connection closed", { sessionId });
      wsConnections.delete(sessionId);
    });

    sharedEventEmitter.on("assistantResponse", (data) => {
      messageQueue.push({ type: "response", data: { response: data } });
      processQueue(ws);

      let sessionHistory = sessions.get(sessionId) || [];
      sessionHistory.push({
        role: "assistant",
        content: data,
      });
      sessions.set(sessionId, sessionHistory);
    });

    sharedEventEmitter.on("debugResponse", (data) => {
      messageQueue.push({ type: "debug", data });
      processQueue(ws);

      let sessionHistory = sessions.get(sessionId) || [];
      sessionHistory.push({
        role: "assistantDebug",
        content: data,
      });
      sessions.set(sessionId, sessionHistory);
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
