FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Install ffmpeg, python and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install ffmpeg, python and yt-dlp in production image
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create directories for audio and transcription files
RUN mkdir -p audios transcricoes

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server/index.js"]
