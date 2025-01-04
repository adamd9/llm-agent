# Use the official Node.js image  
FROM node:18  
  
# Set the working directory  
WORKDIR /usr/src/app  
  
# Copy package files
COPY package*.json ./
  
# Install dependencies  
RUN npm install  
  
# Copy the source code and public files
COPY src/ ./src/
COPY public/ ./public/
  
# Expose the port the app runs on  
EXPOSE 3000  
  
# Start the application  
CMD ["npm", "start"]
