import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  apiKey: string;
  ffmpegPath: string;
  port: number;
  verbose: boolean;
  debug: boolean;
}

// Detectar sistema operacional para definir o caminho padrão do ffmpeg
const defaultFfmpegPath = process.platform === 'win32' 
  ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' 
  : '/usr/bin/ffmpeg';

const config: Config = {
  apiKey: process.env.ASSEMBLYAI_API_KEY || '',
  ffmpegPath: process.env.FFMPEG_PATH || defaultFfmpegPath,
  port: parseInt(process.env.PORT || '3000', 10),
  verbose: process.env.VERBOSE === 'true',
  debug: process.env.DEBUG === 'true'
};

export default config;
