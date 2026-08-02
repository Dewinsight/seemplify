FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies without peer-resolution drift from upstream packages
RUN npm install --omit=dev --legacy-peer-deps

# Copy source code
COPY . .

# Expose port
EXPOSE 5004

# Start the application
CMD ["npm", "start"]
