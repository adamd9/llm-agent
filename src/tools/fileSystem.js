const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class FileSystemTool {
    constructor() {
        // Single root directory for all operations
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

    // Helper to check if path is within data directory and resolve it
    _validatePath(filePath) {
        logger.debug('validatePath', 'Validating path', {
            filePath: filePath,
            dataRoot: this.dataRoot
        });
        // Handle empty or root path
        if (!filePath || filePath === '/' || filePath === '.') {
            return this.dataRoot;
        }

        // Remove leading slash if present
        const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
        
        const resolvedPath = path.resolve(this.dataRoot, normalizedPath);
        
        // Validate the resolved path is within data directory
        if (!resolvedPath.startsWith(this.dataRoot)) {
            throw new Error('Path must be within data directory');
        }

        logger.debug('validatePath', 'Path validated', {
            filePath,
            resolvedPath
        });

        return resolvedPath;
    }

    async execute(action, parameters) {
        logger.debug('FileSystem executing:', JSON.stringify({ action, parameters }));
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.error('Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'error',
                        error: 'Invalid parameters format',
                        details: parseError.message
                    };
                }
            }

            switch (action) {
                case 'read':
                    const readPathParam = parsedParams.find(param => param.name === 'path');
                    if (!readPathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.readFile(readPathParam.value);

                case 'write':
                    const writePathParam = parsedParams.find(param => param.name === 'path');
                    const writeContentParam = parsedParams.find(param => param.name === 'content');
                    if (!writePathParam || !writeContentParam) {
                        throw new Error('Missing required parameters for write: path and content');
                    }
                    return await this.writeFile(writePathParam.value, writeContentParam.value);

                case 'delete':
                    const deletePathParam = parsedParams.find(param => param.name === 'path');
                    if (!deletePathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.deleteFile(deletePathParam.value);

                case 'list':
                    const listPathParam = parsedParams.find(param => param.name === 'path');
                    return await this.listFiles(listPathParam ? listPathParam.value : '.');

                case 'exists':
                    const existsPathParam = parsedParams.find(param => param.name === 'path');
                    if (!existsPathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.fileExists(existsPathParam.value);

                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error('FileSystem tool error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                parameters
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
            const validPath = this._validatePath(filePath);
            
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
        const validPath = this._validatePath(filePath);
        await fs.unlink(validPath);
        return {
            status: 'success',
            path: validPath
        };
    }

    async listFiles(dirPath) {
        const validPath = this._validatePath(dirPath);

        async function getFilesRecursively(currentPath) {
            try {
                const items = await fs.readdir(currentPath, { withFileTypes: true });
                const files = await Promise.all(items.map(async item => {
                    const fullPath = path.join(currentPath, item.name);
                    try {
                        const stats = await fs.stat(fullPath);
                        const result = {
                            name: item.name,
                            path: fullPath,
                            type: item.isDirectory() ? 'directory' : 'file',
                            size: stats.size,
                            modifiedTime: stats.mtime
                        };

                        if (item.isDirectory()) {
                            try {
                                result.children = await getFilesRecursively(fullPath);
                            } catch (dirError) {
                                // If we can't read directory contents, mark it as inaccessible
                                result.children = [];
                                result.error = 'Directory not accessible';
                            }
                        }

                        return result;
                    } catch (statError) {
                        // If we can't stat the file, return basic info
                        return {
                            name: item.name,
                            path: fullPath,
                            type: 'unknown',
                            error: 'File not accessible'
                        };
                    }
                }));

                return files;
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // Directory doesn't exist, return empty array
                    return [];
                }
                throw error; // Re-throw other errors
            }
        }

        try {
            // Ensure data directory exists
            await fs.mkdir(validPath, { recursive: true });
            const files = await getFilesRecursively(validPath);

            return {
                status: 'success',
                files,
                path: validPath
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                path: validPath
            };
        }
    }

    async fileExists(filePath) {
        const validPath = this._validatePath(filePath);
        try {
            await fs.access(validPath);
            return {
                status: 'success',
                exists: true,
                path: validPath
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
                    description: 'List files in the data directory',
                    parameters: []
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
                    description: 'Write to a file',
                    parameters: [
                        {
                            name: 'path',
                            description: 'Path to write',
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
                    description: 'Delete a file',
                    parameters: [{
                        name: 'path',
                        description: 'Path to delete',
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