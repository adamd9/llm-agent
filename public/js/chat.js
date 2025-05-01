let ws;
let currentMessagePersistent = false;
let isProcessing = false;
let systemMessageDiv = null;
let currentResult = null;

function toggleDebug() {
    const modal = document.getElementById('debug-modal');
    const button = document.querySelector('.debug-toggle');
    const isHidden = modal.classList.contains('hidden');
    
    modal.classList.toggle('hidden');
    button.textContent = isHidden ? 'Debug ▲' : 'Debug ▼';
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
}

function toggleResults() {
    const modal = document.getElementById('results-modal');
    const isHidden = modal.classList.contains('hidden');
    
    if (!isHidden && !currentResult) {
        return; // Don't open if there's no result
    }
    
    modal.classList.toggle('hidden');
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
    
    // Update results content if opening
    if (isHidden && currentResult) {
        const output = document.getElementById('results-output');
        output.textContent = currentResult;
    }
}

function toggleStatus(messageDiv) {
    const status = messageDiv.querySelector('.status');
    const toggle = messageDiv.querySelector('.status-toggle');
    
    if (status) {
        const isVisible = status.classList.contains('visible');
        status.classList.toggle('visible');
        toggle.textContent = isVisible ? 'Show result ▼' : 'Hide result ▲';
    }
}

function showStatus(message) {
    // Process message
    let messageText, isPersistent;
    if (typeof message === 'string') {
        messageText = message;
        isPersistent = false;
    } else {
        messageText = message.message;
        isPersistent = message.persistent;
    }
    
    console.log('Status update:', { messageText, isPersistent });
    
    messageText = humanizeStatusMessage(messageText);
    
    if (!systemMessageDiv) {
        console.log('Creating system message div');
        systemMessageDiv = document.createElement('div');
        systemMessageDiv.className = 'message system';
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv.firstChild) {
            messagesDiv.insertBefore(systemMessageDiv, messagesDiv.firstChild);
        } else {
            messagesDiv.appendChild(systemMessageDiv);
        }
    }
    
    if (isPersistent) {
        // Store the result and show a button to view it
        currentResult = messageText;
        const viewButton = '<button onclick="toggleResults()" class="view-results-button">View Results ▼</button>';
        const spinner = '<span class="spinner"></span>';
        systemMessageDiv.innerHTML = `${spinner}Results ready ${viewButton}`;
    } else {
        // Show non-persistent messages in the system message area
        const spinner = '<span class="spinner"></span>';
        systemMessageDiv.innerHTML = `${spinner}${messageText}`;
    }
    
    currentMessagePersistent = isPersistent;
}

function clearStatus() {
    if (!currentMessagePersistent && systemMessageDiv) {
        systemMessageDiv.innerHTML = '';
    }
    if (!currentMessagePersistent) {
        currentResult = null;
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

    return message;
}

function addMessage(type, content, format = 'basic') {
    console.log('Adding message:', { type, content });
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    if (format === 'markdown') {
        // Add markdown formatting if needed
        messageDiv.textContent = content;
    } else {
        messageDiv.textContent = content;
    }
    
    // For system messages, insert after the system status if it exists
    if (type === 'system' && systemMessageDiv) {
        systemMessageDiv.after(messageDiv);
    } else {
        messagesDiv.appendChild(messageDiv);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function connect() {
    ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
        console.log('Connected to server');
        showStatus('Connected to server');
        
        // Enable input and button
        document.getElementById('user-input').disabled = false;
        document.getElementById('send-button').disabled = false;
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        
        switch(data.type) {
            case 'response':
                const response = data.data.response;
                addMessage('assistant', response);
                clearStatus();
                break;
                
            case 'working':
                console.log('Working status update:', data.data.status);
                showStatus(data.data.status);
                break;
                
            case 'debug':
                const debugOutput = document.getElementById('debug-output');
                const debugMessage = typeof data.data === 'object' ? 
                    JSON.stringify(data.data, null, 2) : 
                    data.data;
                debugOutput.textContent += debugMessage + '\n';
                debugOutput.scrollTop = debugOutput.scrollHeight;
                break;
                
            case 'error':
                console.error('Server error:', data.error);
                addMessage('error', `Error: ${data.error}`);
                clearStatus();
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

// Initialize WebSocket connection
document.addEventListener('DOMContentLoaded', () => {
    connect();
    
    // Add event listeners
    document.getElementById('user-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    document.getElementById('send-button').addEventListener('click', sendMessage);

    // Close modals on background click
    document.getElementById('debug-modal').addEventListener('click', (e) => {
        if (e.target.id === 'debug-modal') {
            toggleDebug();
        }
    });
    
    document.getElementById('results-modal').addEventListener('click', (e) => {
        if (e.target.id === 'results-modal') {
            toggleResults();
        }
    });
});
