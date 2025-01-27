const toolParameterSchema = {
    type: 'object',
    required: ['name', 'description', 'type', 'required'],
    properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        type: { 
            type: 'string',
            enum: ['string', 'number', 'boolean', 'array', 'object']
        },
        required: { type: 'boolean' }
    }
};

const toolActionSchema = {
    type: 'object',
    required: ['name', 'description', 'parameters'],
    properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        parameters: {
            type: 'array',
            items: toolParameterSchema
        }
    }
};

const toolCapabilitiesSchema = {
    type: 'object',
    required: ['name', 'description', 'actions'],
    properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        actions: {
            type: 'array',
            items: toolActionSchema
        }
    }
};

const toolResponseSchema = {
    type: 'object',
    required: ['status'],
    properties: {
        status: {
            type: 'string',
            enum: ['success', 'error']
        },
        message: { type: 'string' },
        error: { type: 'string' },
        data: { }  // Any type allowed for data
    }
};

module.exports = {
    toolParameterSchema,
    toolActionSchema,
    toolCapabilitiesSchema,
    toolResponseSchema
};
