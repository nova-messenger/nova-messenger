# Dockerfile for Aether Messenger
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/aether.db

# Create data and uploads directories
RUN mkdir -p /app/data /app/public/uploads

# Run application
CMD ["node", "server.js"]
