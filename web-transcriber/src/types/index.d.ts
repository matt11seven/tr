// Definições de tipos para bibliotecas sem tipos oficiais

declare module 'ytdl-core' {
  export interface VideoInfo {
    videoDetails: {
      title: string;
      lengthSeconds: string;
      author: {
        name: string;
      };
    };
  }

  export interface Format {
    contentLength: string;
    qualityLabel?: string;
    quality: string;
    container: string;
    audioCodec: string;
  }

  export function getInfo(url: string): Promise<VideoInfo>;
  export function validateURL(url: string): boolean;
  export default function ytdl(url: string, options?: any): NodeJS.ReadableStream;
}

declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    audioBitrate(bitrate: number): FfmpegCommand;
    save(outputPath: string): FfmpegCommand;
    on(event: 'start', callback: (command: string) => void): FfmpegCommand;
    on(event: 'progress', callback: (progress: any) => void): FfmpegCommand;
    on(event: 'end', callback: () => void): FfmpegCommand;
    on(event: 'error', callback: (err: Error) => void): FfmpegCommand;
  }

  function setFfmpegPath(path: string): void;
  function ffmpeg(input: any): FfmpegCommand;

  export default {
    setFfmpegPath,
    ffmpeg
  };
}

// Definição para FormData
declare module 'form-data' {
  class FormData {
    append(name: string, value: any, options?: any): void;
    getHeaders(): Record<string, string>;
  }
  export = FormData;
}
