# MCP Client Sequence Flows

## Tool Loading Sequence
```mermaid
sequenceDiagram
    participant TM as ToolManager
    participant MCP as MCPServerTool
    participant FS as FileSystem
    participant Srv as MCP Server

    TM->>MCP: loadTools()
    MCP->>FS: scan mcp-servers directories
    FS-->>MCP: server files
    loop For each server
        MCP->>Srv: spawn process
        Srv-->>MCP: register(name, tools)
        MCP->>MCP: validate tools
        MCP->>MCP: aggregate tools
    end
    MCP-->>TM: tools registered
```

## Tool Execution Sequence
```mermaid
sequenceDiagram
    participant Ego as Ego
    participant TM as ToolManager
    participant MCP as MCPServerTool
    participant Srv as MCP Server

    Ego->>TM: execute(action, params)
    TM->>MCP: execute(action, params)
    MCP->>MCP: find target server
    MCP->>Srv: send execution request
    Srv->>Srv: process request
    Srv-->>MCP: execution result
    MCP-->>TM: formatted result
    TM-->>Ego: final result
```

## Error Handling Sequence
```mermaid
sequenceDiagram
    participant TM as ToolManager
    participant MCP as MCPServerTool
    participant Srv as MCP Server
    participant Log as Logger

    TM->>MCP: execute(action, params)
    MCP->>Srv: send request
    alt Server Error
        Srv--xMCP: error response
        MCP->>Log: log error
        MCP->>MCP: mark server inactive
        MCP-->>TM: error result
    else Timeout
        MCP->>Srv: check status
        Srv--xMCP: no response
        MCP->>MCP: restart server
        MCP-->>TM: retry error
    end
```

## Server Lifecycle Sequence
```mermaid
sequenceDiagram
    participant TM as ToolManager
    participant MCP as MCPServerTool
    participant Srv as MCP Server
    participant Log as Logger

    TM->>MCP: initialize()
    MCP->>Srv: spawn process
    Srv-->>MCP: ready
    
    loop Health Check
        MCP->>Srv: ping
        Srv-->>MCP: pong
    end

    alt Server Dies
        Srv--xMCP: process exit
        MCP->>Log: log error
        MCP->>Srv: respawn process
        Srv-->>MCP: ready
    end

    TM->>MCP: cleanup()
    MCP->>Srv: terminate
    Srv-->>MCP: terminated
    MCP->>MCP: clear resources
```

## Message Protocol Sequence
```mermaid
sequenceDiagram
    participant MCP as MCPServerTool
    participant Srv as MCP Server

    Srv->>MCP: register
    Note over MCP,Srv: Server sends capabilities
    MCP-->>Srv: ack

    MCP->>Srv: execute
    Note over MCP,Srv: Tool execution request
    Srv-->>MCP: result

    MCP->>Srv: ping
    Note over MCP,Srv: Health check
    Srv-->>MCP: pong

    MCP->>Srv: terminate
    Note over MCP,Srv: Cleanup request
    Srv-->>MCP: terminated
```

## Tool Discovery Sequence
```mermaid
sequenceDiagram
    participant TM as ToolManager
    participant MCP as MCPServerTool
    participant FS as FileSystem
    participant Srv as MCP Server

    TM->>MCP: loadTools()
    MCP->>FS: readdir(src/mcp-servers)
    FS-->>MCP: core servers
    MCP->>FS: readdir(data/mcp-servers)
    FS-->>MCP: custom servers

    loop For Each Server
        MCP->>FS: validate file
        FS-->>MCP: file info
        MCP->>Srv: spawn process
        Srv-->>MCP: register
        MCP->>MCP: validate tools
        MCP->>MCP: add to registry
    end

    MCP-->>TM: tools loaded
```
