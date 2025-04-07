FROM node:18-alpine AS builder

WORKDIR /app

# Copy the web-transcriber directory
COPY web-transcriber/ ./

# Install dependencies
RUN npm ci || npm install

# Install ffmpeg, python and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install --upgrade pip
RUN pip3 install yt-dlp
# Verify yt-dlp installation
RUN python3 -m yt_dlp --version

# Build the application
RUN npm run build || echo "Build step skipped"

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install ffmpeg, python and yt-dlp in production image
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install --upgrade pip
RUN pip3 install yt-dlp
# Verify yt-dlp installation
RUN python3 -m yt_dlp --version

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
ENV VERBOSE=true
ENV DEBUG=true

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server/index.js"]