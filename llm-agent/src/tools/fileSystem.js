const fs = require('fs').promises;
const path = require('path');

class FileSystemTool {
    constructor() {
        // Read-only directory for app source code
        this.appRoot = path.resolve(__dirname, '..');
        // Read-write directory for data
        this.dataRoot = path.resolve(__dirname, '../../data');
        this.name = 'fileSystem';
        this.description = 'Tool for file system operations';
    }

    async initialize() {
        // Ensure data directory exists
        try {
            await fs.access(this.dataRoot);
        } catch {
            await fs.mkdir(this.dataRoot, { recursive: true });
        }
    }

    // Helper to check if path is within allowed directories and resolve it
    _validatePath(filePath, requireWritable = false) {
        // Handle empty or root path
        if (!filePath || filePath === '/' || filePath === '.') {
            return this.dataRoot;
        }

        // Try data directory first, then app directory
        let resolvedPath;
        if (filePath.startsWith('/')) {
            // Absolute path - try to match with data or app root
            resolvedPath = filePath.startsWith(this.dataRoot) ? filePath :
                          filePath.startsWith(this.appRoot) ? filePath : null;
        } else {
            // Relative path - try data directory first, then app
            resolvedPath = path.resolve(this.dataRoot, filePath);
            if (!resolvedPath.startsWith(this.dataRoot)) {
                resolvedPath = path.resolve(this.appRoot, filePath);
            }
        }

        // Validate the resolved path
        if (!resolvedPath || 
            (!resolvedPath.startsWith(this.dataRoot) && !resolvedPath.startsWith(this.appRoot))) {
            throw new Error('Path must be within app or data directory');
        }

        if (requireWritable && resolvedPath.startsWith(this.appRoot)) {
            throw new Error('App directory is read-only');
        }

        return resolvedPath;
    }

    async execute(action, params) {
        console.log('FileSystem executing:', { action, params });
        try {
            switch (action) {
                case 'read':
                    return await this.readFile(params.path);
                case 'write':
                    if (!params || !params.path || !params.content) {
                        const error = new Error('Missing required parameters for write: path and content');
                        console.error('Parameter validation error:', {
                            error: error.message,
                            stack: error.stack,
                            params
                        });
                        return {
                            status: 'error',
                            error: error.message,
                            stack: error.stack,
                            params
                        };
                    }
                    return await this.writeFile(params.path, params.content);
                case 'delete':
                    return await this.deleteFile(params.path);
                case 'list':
                    return await this.listFiles(params.path);
                case 'exists':
                    return await this.fileExists(params.path);
                default:
                    const error = new Error(`Unknown action: ${action}`);
                    console.error('Invalid action error:', {
                        error: error.message,
                        stack: error.stack,
                        action,
                        params
                    });
                    return {
                        status: 'error',
                        error: error.message,
                        stack: error.stack,
                        action,
                        params
                    };
            }
        } catch (error) {
            console.error('FileSystem tool error:', {
                error: error.message,
                stack: error.stack,
                action,
                params
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                params
            };
        }
    }

    async readFile(filePath) {
        const validPath = this._validatePath(filePath);
        const content = await fs.readFile(validPath, 'utf8');
        return {
            status: 'success',
            content,
            path: validPath
        };
    }

    async writeFile(filePath, content) {
        if (!content) {
            return {
                status: 'error',
                error: 'Content is required for write operation'
            };
        }

        let fileHandle;
        try {
            const validPath = this._validatePath(filePath, true);
            
            // Use file handle for atomic write
            fileHandle = await fs.open(validPath, 'w');
            try {
                await fileHandle.writeFile(content);
                await fileHandle.sync(); // Force write to disk
            } finally {
                if (fileHandle) {
                    await fileHandle.close();
                }
            }
            
            // Verify the write was successful
            const written = await fs.readFile(validPath, 'utf8');
            if (written !== content) {
                throw new Error(`File content verification failed. Expected "${content}" but got "${written}"`);
            }

            return {
                status: 'success',
                path: validPath,
                content: content,
                size: Buffer.from(content).length
            };
        } catch (error) {
            console.error('Write error:', {
                error: error.message,
                stack: error.stack,
                path: filePath
            });
            return {
                status: 'error',
                error: `Failed to write file ${filePath}: ${error.message}`,
                details: {
                    originalError: error.message,
                    stack: error.stack,
                    path: filePath
                }
            };
        }
    }

    async deleteFile(filePath) {
        const validPath = this._validatePath(filePath, true);
        await fs.unlink(validPath);
        return {
            status: 'success',
            path: validPath
        };
    }

    async listFiles(dirPath) {
        const validPath = this._validatePath(dirPath);
        const items = await fs.readdir(validPath, { withFileTypes: true });
        const files = await Promise.all(items.map(async item => {
            const fullPath = path.join(validPath, item.name);
            const stats = await fs.stat(fullPath);
            return {
                name: item.name,
                path: fullPath,
                type: item.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                isReadOnly: fullPath.startsWith(this.appRoot)
            };
        }));

        return {
            status: 'success',
            files,
            path: validPath,
            isReadOnly: validPath.startsWith(this.appRoot)
        };
    }

    async fileExists(filePath) {
        const validPath = this._validatePath(filePath);
        try {
            await fs.access(validPath);
            return {
                status: 'success',
                exists: true,
                path: validPath,
                isReadOnly: validPath.startsWith(this.appRoot)
            };
        } catch {
            return {
                status: 'success',
                exists: false,
                path: validPath
            };
        }
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'list',
                    description: 'List files in a directory',
                    parameters: [{
                        name: 'path',
                        description: 'Path to list (defaults to data directory)',
                        type: 'string',
                        required: false
                    }]
                },
                {
                    name: 'read',
                    description: 'Read a file',
                    parameters: [{
                        name: 'path',
                        description: 'Path to the file to read',
                        type: 'string',
                        required: true
                    }]
                },
                {
                    name: 'write',
                    description: 'Write to a file (only in data directory)',
                    parameters: [
                        {
                            name: 'path',
                            description: 'Path to write (relative to data directory)',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'content',
                            description: 'Content to write to the file',
                            type: 'string',
                            required: true
                        }
                    ]
                },
                {
                    name: 'delete',
                    description: 'Delete a file (only in data directory)',
                    parameters: [{
                        name: 'path',
                        description: 'Path to delete (relative to data directory)',
                        type: 'string',
                        required: true
                    }]
                },
                {
                    name: 'exists',
                    description: 'Check if a file exists',
                    parameters: [{
                        name: 'path',
                        description: 'Path to check',
                        type: 'string',
                        required: true
                    }]
                }
            ],
            rootDirectories: {
                app: {
                    path: this.appRoot,
                    access: 'read-only',
                    description: 'Application source code directory'
                },
                data: {
                    path: this.dataRoot,
                    access: 'read-write',
                    description: 'Data storage directory'
                }
            }
        };
    }
}

module.exports = new FileSystemTool();
