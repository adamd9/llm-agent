# Use the official Node.js image  
FROM node:18  
  
# Create app directory and set permissions
WORKDIR /usr/src/app  

# Create a non-root user with the same UID as the host user
RUN groupadd -g 501 appuser && \
    useradd -u 501 -g appuser -s /bin/bash -m appuser && \
    chown -R appuser:appuser /usr/src/app

# Copy package files
COPY --chown=appuser:appuser package*.json ./
  
# Install dependencies  
RUN npm install  
  
# Copy the source code and public files
COPY --chown=appuser:appuser src/ ./src/
COPY --chown=appuser:appuser public/ ./public/

# Switch to non-root user
USER appuser
  
# Expose the port the app runs on  
EXPOSE 3000  
  
# Start the application  
CMD ["npm", "start"]
