let ws;
let messageQueue = [];
let statusTimeout;
let currentMessagePersistent = false;
let isProcessing = false;

function showStatus(message, duration = 5000) {
    const output = document.getElementById('status-output');
    const statusText = output.querySelector('.status-text');
    
    // Clear any existing timeout
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }

    // Process message
    let messageText, isPersistent;
    if (typeof message === 'string') {
        messageText = message;
        isPersistent = false;
    } else {
        messageText = message.message;
        isPersistent = message.persistent;
    }

    // Update message
    statusText.textContent = humanizeStatusMessage(messageText);
    output.classList.add('visible');
    
    // Update text alignment based on persistence
    if (isPersistent) {
        statusText.classList.add('persistent');
    } else {
        statusText.classList.remove('persistent');
    }
    
    if (!isPersistent && !currentMessagePersistent) {
        statusTimeout = setTimeout(() => {
            statusText.textContent = '';
            output.classList.remove('visible');
        }, duration);
    }

    // Update persistent state
    currentMessagePersistent = isPersistent;
}

function clearStatus() {
    const output = document.getElementById('status-output');
    const statusText = output.querySelector('.status-text');
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }
    
    // Only clear the status text if it wasn't persistent
    if (!currentMessagePersistent) {
        statusText.textContent = '';
        statusText.classList.remove('persistent');
    }

    // Remove spinner but keep output visible if we have a persistent message
    document.querySelector('.spinner').classList.remove('visible');
    if (!currentMessagePersistent) {
        output.classList.remove('visible');
    }
    isProcessing = false;
}

function humanizeStatusMessage(message) {
    const messageMap = {
        'Starting to work on your request...': '💭 Thinking...',
        'Starting execution of the plan...': '🔧 Working on it...',
        'Executing the plan...': '🚀 Almost there...',
        'query': '📨 Querying model...',
        'evalForUpdate': 'Evaluating results...'           
    };

    if (messageMap[message]) {
        return messageMap[message];
    }

    if (message.includes('scored') && message.includes('Making adjustments')) {
        return '🔄 Improving the response...';
    }

    return message
        .replace(/\.$/, '')
        .replace(/\.\.\.$/, '');
}

function connect() {
    ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
        console.log('Connected to server');
        showStatus('Connected to server', 2000);
        
        // Enable input and button
        document.getElementById('user-input').disabled = false;
        document.getElementById('send-button').disabled = false;
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'response':
                const response = data.data.response;
                addMessage('assistant', response);
                break;
                
            case 'working':
                showStatus(data.data.status);
                break;
                
            case 'debug':
                const debugContainer = document.getElementById('debug-output');
                if (debugContainer) {
                    const debugMessage = typeof data.data === 'object' ? 
                        JSON.stringify(data.data, null, 2) : 
                        data.data;
                    debugContainer.textContent += debugMessage + '\n';
                    debugContainer.scrollTop = debugContainer.scrollHeight;
                }
                break;
                
            case 'error':
                console.error('Server error:', data.error);
                addMessage('error', `Error: ${data.error}`);
                break;

            case 'session':
                console.log('Session ID:', data.sessionId);
                break;
        }
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
        setTimeout(connect, 1000); // Reconnect after 1 second
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addMessage('error', 'Connection error. Please try again.');
    };
}

function addMessage(type, content, format = 'basic') {
    const container = document.getElementById('chat-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    if (format === 'markdown') {
        messageDiv.classList.add('markdown-content');
        // Note: You'll need to add a markdown parser library to properly render markdown
        messageDiv.textContent = content;
    } else if (format === 'code') {
        const pre = document.createElement('pre');
        pre.className = 'code-block';
        pre.textContent = content;
        messageDiv.appendChild(pre);
    } else {
        messageDiv.textContent = content;
    }
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('user-input');
    const message = input.value.trim();
    
    if (message && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            message: message
        }));
        
        addMessage('user', message);
        input.value = '';
    }
}

function toggleDebug() {
    const container = document.getElementById('output-container');
    container.classList.toggle('collapsed');
}

// Initialize WebSocket connection
document.addEventListener('DOMContentLoaded', () => {
    connect();
    
    // Focus input field
    document.getElementById('user-input').focus();
    
    // Add event listeners
    document.getElementById('user-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    document.getElementById('send-button').addEventListener('click', sendMessage);
});
