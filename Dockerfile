FROM node:18-alpine AS builder

WORKDIR /app

# Copy the web-transcriber directory
COPY web-transcriber/ ./

# Install dependencies
RUN npm ci || npm install

# Install ffmpeg, python and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp --break-system-packages
# Verify yt-dlp installation
RUN python3 -m yt_dlp --version

# Build the application
RUN npm run build || echo "Build step skipped"

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install ffmpeg, python and yt-dlp in production image
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp --break-system-packages
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
ENV PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Expose the port
EXPOSE 3000

# Copiar script de inicialização
COPY --from=builder /app/start.sh ./
RUN chmod +x start.sh

# Start the server using the initialization script
CMD ["/bin/sh", "./start.sh"]