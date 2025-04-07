// Definições de tipos para bibliotecas sem tipos oficiais

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
