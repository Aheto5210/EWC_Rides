# Use Node.js LTS
FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (include all for build step)
RUN npm ci && npm cache clean --force

# Copy application code
COPY . .

# Build frontend with API_BASE_URL
ARG API_BASE_URL=http://localhost:3331
RUN API_BASE_URL=$API_BASE_URL npm run build

# Create data directory for SQLite database
RUN mkdir -p /app/server/data

# Expose port
EXPOSE 3331

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3331/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Run the application (serve from build folder)
CMD ["sh", "-c", "PUBLIC_DIR=/app/build PORT=3331 node server/index.js"]
