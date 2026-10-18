FROM node:20-alpine

WORKDIR /app

# Convert browser call recordings to bounded PCM segments for managed STT.
RUN apk add --no-cache ffmpeg

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
