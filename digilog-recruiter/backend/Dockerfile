FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies without peer-resolution drift from upstream packages
RUN npm install --omit=dev --legacy-peer-deps && npm install graphql --no-save --legacy-peer-deps

# Copy source code
COPY . .

# Expose port
EXPOSE 5001

# Start the application
CMD ["npm", "start"]
