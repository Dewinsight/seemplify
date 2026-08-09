FROM node:22-bookworm-slim

WORKDIR /app

# Install LibreOffice and common fonts so uploaded DOCX files can be converted
# to PDF without rebuilding the document from raw text.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fontconfig \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

ENV LIBREOFFICE_PATH=/usr/bin/soffice
ENV HOME=/tmp

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
