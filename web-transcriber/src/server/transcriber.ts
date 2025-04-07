import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import { Server } from 'socket.io';
import ytdl from 'ytdl-core';
import config from './config';

// Types
export interface TranscriptionJob {
  id: string;
  videoUrl: string;
  status: 'pending' | 'downloading' | 'transcribing' | 'completed' | 'error';
  progress: {
    download: number;
    transcription: number;
  };
  result?: {
    transcriptPath: string;
    simplePath: string;
  };
  error?: string;
  createdAt: Date;
}

export class Transcriber {
  private jobs: Map<string, TranscriptionJob> = new Map();
  private io: Server;
  private apiKey: string;
  private ffmpegPath: string;

  constructor(io: Server) {
    this.io = io;
    this.apiKey = config.apiKey;
    this.ffmpegPath = config.ffmpegPath;
    
    // Log configuration if verbose mode is enabled
    if (config.verbose) {
      console.log('Transcriber initialized with:', {
        apiKey: this.apiKey ? '***' + this.apiKey.substring(this.apiKey.length - 4) : 'Not set',
        ffmpegPath: this.ffmpegPath,
        verbose: config.verbose,
        debug: config.debug
      });
    }
    
    // Create directories if they don't exist
    if (!fs.existsSync('audios')) {
      fs.mkdirSync('audios');
      if (config.verbose) console.log('Created audios directory');
    }
    if (!fs.existsSync('transcricoes')) {
      fs.mkdirSync('transcricoes');
      if (config.verbose) console.log('Created transcricoes directory');
    }
    
    // Set ffmpeg path
    try {
      ffmpeg.setFfmpegPath(this.ffmpegPath);
      if (config.verbose) console.log('FFmpeg path set to:', this.ffmpegPath);
      
      // Test if ffmpeg is available
      const testProcess = spawn(this.ffmpegPath, ['-version']);
      testProcess.on('error', (err) => {
        console.error('FFmpeg error:', err.message);
      });
      testProcess.stdout.on('data', (data) => {
        if (config.verbose) console.log('FFmpeg version:', data.toString().split('\n')[0]);
      });
    } catch (error) {
      console.error('Error setting FFmpeg path:', error);
    }
  }

  public async startTranscription(videoUrl: string): Promise<string> {
    // Validate inputs
    if (!this.apiKey) {
      throw new Error('AssemblyAI API key not found');
    }
    
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg path not found');
    }
    
    // Validação básica de URL do YouTube
    if (!videoUrl.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/)) {
      throw new Error('Invalid YouTube URL');
    }
    
    // Create job
    const jobId = uuidv4();
    const job: TranscriptionJob = {
      id: jobId,
      videoUrl,
      status: 'pending',
      progress: {
        download: 0,
        transcription: 0
      },
      createdAt: new Date()
    };
    
    this.jobs.set(jobId, job);
    
    // Start processing in background
    this.processVideo(jobId, videoUrl).catch(error => {
      console.error(`Error processing job ${jobId}:`, error);
      this.updateJobStatus(jobId, 'error', error.message);
    });
    
    return jobId;
  }

  public getJob(jobId: string): TranscriptionJob | undefined {
    return this.jobs.get(jobId);
  }

  public getAllJobs(): TranscriptionJob[] {
    return Array.from(this.jobs.values());
  }

  private async processVideo(jobId: string, videoUrl: string): Promise<void> {
    try {
      if (config.verbose) console.log(`[Job ${jobId}] Starting video processing for URL: ${videoUrl}`);
      
      // Extrair ID do vídeo para usar como nome do arquivo
      const videoId = this.extractVideoId(videoUrl);
      if (!videoId) {
        throw new Error(`Could not extract video ID from URL: ${videoUrl}`);
      }
      
      // Obter timestamp para garantir nomes únicos
      const timestamp = new Date().getTime();
      const videoTitle = `video_${videoId}_${timestamp}`;
      
      if (config.verbose) {
        console.log(`[Job ${jobId}] Using video ID: ${videoId}`);
      }
      
      // Set file paths
      const audioPath = path.join('audios', `${videoTitle}.mp3`);
      const transcriptPath = path.join('transcricoes', `${videoTitle}.txt`);
      const simplePath = path.join('transcricoes', `${videoTitle}_simples.txt`);
      
      if (config.verbose) {
        console.log(`[Job ${jobId}] File paths:`, {
          audioPath,
          transcriptPath,
          simplePath
        });
      }
      
      // Check if transcript already exists
      if (fs.existsSync(transcriptPath)) {
        if (config.verbose) console.log(`[Job ${jobId}] Transcript already exists: ${transcriptPath}`);
        this.updateJobStatus(jobId, 'completed', undefined, {
          transcriptPath,
          simplePath
        });
        return;
      }
      
      // Download video
      if (config.verbose) console.log(`[Job ${jobId}] Starting video download...`);
      await this.downloadVideo(jobId, videoUrl, audioPath);
      
      // Check if audio file exists after download
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not created after download: ${audioPath}`);
      }
      
      if (config.verbose) {
        const stats = fs.statSync(audioPath);
        console.log(`[Job ${jobId}] Audio file downloaded:`, {
          path: audioPath,
          size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
          created: stats.birthtime
        });
      }
      
      // Transcribe audio
      if (config.verbose) console.log(`[Job ${jobId}] Starting audio transcription...`);
      await this.transcribeAudio(jobId, audioPath, transcriptPath, simplePath, videoTitle, videoUrl);
      
      // Update job status
      if (config.verbose) console.log(`[Job ${jobId}] Transcription completed successfully`);
      this.updateJobStatus(jobId, 'completed', undefined, {
        transcriptPath,
        simplePath
      });
      
      // Clean up audio file
      if (config.verbose) console.log(`[Job ${jobId}] Cleaning up audio file: ${audioPath}`);
      fs.unlinkSync(audioPath);
      if (config.verbose) console.log(`[Job ${jobId}] Process completed successfully`);
      
    } catch (error: any) {
      console.error(`[Job ${jobId}] Error processing video:`, error);
      this.updateJobStatus(jobId, 'error', error.message);
    }
  }
  


  // Método auxiliar para extrair o ID do vídeo do YouTube
  private extractVideoId(url: string): string | null {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
  }

  private async downloadVideo(jobId: string, videoUrl: string, outputPath: string): Promise<void> {
    // Extrair o ID do vídeo para usar com o script Python
    const videoId = this.extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error(`Could not extract video ID from URL: ${videoUrl}`);
    }
    
    if (config.verbose) console.log(`[Job ${jobId}] Chamando script Python para download...`);
    
    // Usar o script Python existente que está funcionando corretamente
    return new Promise((resolve, reject) => {
      try {
        // Verificar se o diretório de áudio existe
        const audioDir = path.dirname(outputPath);
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        
        // Calcular o nome base do arquivo de saída sem extensão
        const outputBasename = path.basename(outputPath, '.mp3');
        
        // Chamada para o script Python com parâmetros necessários
        // O script Python é responsável por baixar o áudio e convertê-lo para MP3
        const pythonScript = spawn('python3', [
          // Caminho absoluto para o script relativo à raiz do projeto
          path.join(process.cwd(), '../transcribe.py'),
          '--mode', 'download-only',
          '--video-id', videoId,
          '--output', outputPath
        ]);
        
        if (config.verbose) console.log(`[Job ${jobId}] Iniciando processo Python para download...`);
        
        pythonScript.stdout.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] Python stdout: ${output.trim()}`);
          }
          
          // Tentar extrair progresso do output, se disponível
          const match = output.match(/(\d+)% concluído/);
          if (match && match[1]) {
            const percent = parseInt(match[1], 10);
            this.updateJobProgress(jobId, 'download', percent);
          }
        });
        
        pythonScript.stderr.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] Python stderr: ${output.trim()}`);
          }
        });
        
        pythonScript.on('close', (code) => {
          if (code === 0) {
            if (config.verbose) console.log(`[Job ${jobId}] Python process completed successfully`);
            
            // Verificar se o arquivo foi criado
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              if (config.verbose) {
                console.log(`[Job ${jobId}] Audio file downloaded:`, {
                  path: outputPath,
                  size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                  created: stats.birthtime
                });
              }
              
              this.updateJobProgress(jobId, 'download', 100);
              resolve();
            } else {
              const error = new Error(`Audio file not created: ${outputPath}`);
              console.error(`[Job ${jobId}] ${error.message}`);
              reject(error);
            }
          } else {
            const error = new Error(`Python process exited with code ${code}`);
            console.error(`[Job ${jobId}] ${error.message}`);
            reject(error);
          }
        });
      } catch (error) {
        console.error(`[Job ${jobId}] Error running Python script: ${error}`);
        reject(error);
      }
    });
  }
  


  private async downloadWithYtDlp(jobId: string, videoUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (config.verbose) console.log(`[Job ${jobId}] Starting download process for: ${videoUrl}`);
      this.updateJobStatus(jobId, 'downloading');
      
      try {
        // Usar yt-dlp em vez de ytdl-core
        if (config.verbose) console.log(`[Job ${jobId}] Starting yt-dlp download process`);
        
        // Definir o diretório de saída e nome do arquivo temporário
        const audioDir = path.dirname(outputPath);
        const tempFileName = path.basename(outputPath);
        
        // Garantir que o diretório existe
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        
        // Obter o template de saída (sem extensão) como no código Python
        const outputTemplate = outputPath.replace(/\.mp3$/, '');
        
        // Usar exatamente as mesmas opções que funcionam no código Python (transcribe.py linha 145-157)
        const ytDlpProcess = spawn('python3', ['-m', 'yt_dlp', 
          '--ffmpeg-location', this.ffmpegPath,
          '--format', 'bestaudio/best',
          '--extract-audio',
          '--audio-format', 'mp3',
          '--audio-quality', '192',
          '--output', outputTemplate,
          '--quiet',
          '--no-warnings',
          videoUrl
        ]);
        
        let lastLogTime = Date.now();
        let progressRegex = /\[download\]\s+(\d+\.?\d*)%/;
        
        ytDlpProcess.stdout.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] yt-dlp output: ${output.trim()}`);
          }
          
          // Extrair informações de progresso
          const match = output.match(progressRegex);
          if (match && match[1]) {
            const percent = parseFloat(match[1]);
            
            // Atualizar progresso
            this.updateJobProgress(jobId, 'download', percent);
            
            // Log progress every 5 seconds if verbose
            const now = Date.now();
            if (config.verbose && (now - lastLogTime > 5000)) {
              lastLogTime = now;
              console.log(`[Job ${jobId}] Download progress: ${percent.toFixed(1)}%`);
            }
          }
        });
        
        ytDlpProcess.stderr.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] yt-dlp stderr: ${output.trim()}`);
          }
        });
        
        ytDlpProcess.on('close', (code) => {
          if (code === 0) {
            if (config.verbose) console.log(`[Job ${jobId}] yt-dlp process completed successfully`);
            
            // Verificar se o arquivo foi criado
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              if (config.verbose) {
                console.log(`[Job ${jobId}] Audio file downloaded:`, {
                  path: outputPath,
                  size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                  created: stats.birthtime
                });
              }
              
              this.updateJobProgress(jobId, 'download', 100);
              resolve();
            } else {
              const error = new Error(`Audio file not created: ${outputPath}`);
              console.error(`[Job ${jobId}] ${error.message}`);
              reject(error);
            }
          } else {
            const error = new Error(`yt-dlp process exited with code ${code}`);
            console.error(`[Job ${jobId}] ${error.message}`);
            reject(error);
          }
        });
        
        ytDlpProcess.on('error', (err) => {
          console.error(`[Job ${jobId}] Error in yt-dlp process:`, err);
          reject(new Error(`yt-dlp error: ${err.message}`));
        });
        
      } catch (error) {
        console.error(`[Job ${jobId}] Unexpected error in downloadVideo:`, error);
        reject(error);
      }
    });
  }

  private async transcribeAudio(
    jobId: string, 
    audioPath: string, 
    transcriptPath: string, 
    simplePath: string,
    videoTitle: string,
    videoUrl: string
  ): Promise<void> {
    if (config.verbose) console.log(`[Job ${jobId}] Starting audio transcription process`);
    this.updateJobStatus(jobId, 'transcribing');
    
    try {
      // Upload audio file
      if (config.verbose) console.log(`[Job ${jobId}] Step 1/4: Uploading audio file...`);
      const uploadUrl = await this.uploadAudio(audioPath);
      
      // Start transcription
      if (config.verbose) console.log(`[Job ${jobId}] Step 2/4: Starting transcription job...`);
      const transcriptId = await this.startTranscriptionJob(uploadUrl);
      
      // Wait for completion
      if (config.verbose) console.log(`[Job ${jobId}] Step 3/4: Waiting for transcription to complete...`);
      const transcript = await this.waitForTranscriptionCompletion(jobId, transcriptId);
      
      // Save transcript
      if (config.verbose) console.log(`[Job ${jobId}] Step 4/4: Saving transcript...`);
      await this.saveTranscript(transcript, transcriptPath, simplePath, videoTitle, videoUrl);
      
      if (config.verbose) console.log(`[Job ${jobId}] Transcription process completed successfully`);
    } catch (error: any) {
      console.error(`[Job ${jobId}] Error in transcribeAudio:`, error);
      throw new Error(`Transcription error: ${error.message}`);
    }
  }

  private async downloadWithYtDlpAlternative(jobId: string, videoUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (config.verbose) console.log(`[Job ${jobId}] Tentando download alternativo para: ${videoUrl}`);
      this.updateJobStatus(jobId, 'downloading');
      
      try {
        // Definir o diretório de saída e nome do arquivo temporário
        const audioDir = path.dirname(outputPath);
        const tempFileName = path.basename(outputPath);
        
        // Garantir que o diretório existe
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        
        // Obter o template de saída (sem extensão) como no código Python
        const outputTemplate = outputPath.replace(/\.mp3$/, '');
        
        // Usar uma configuração simplificada com opções extras para bypass
        const ytDlpProcess = spawn('python3', ['-m', 'yt_dlp', 
          '--ffmpeg-location', this.ffmpegPath,
          '--format', 'bestaudio/best',
          '--extract-audio',
          '--audio-format', 'mp3',
          '--audio-quality', '192',
          '--output', outputTemplate,
          '--quiet',
          '--no-warnings',
          // Opções adicionais para contornar restrições
          '--no-check-certificate',
          '--ignore-errors',
          '--extractor-args', 'youtube:player_client=android',
          '--extractor-retries', '10',
          '--retry-sleep', '5',
          '--force-ipv4',
          '--geo-bypass',
          videoUrl
        ]);
        
        let lastLogTime = Date.now();
        let progressRegex = /\[download\]\s+(\d+\.?\d*)%/;
        
        ytDlpProcess.stdout.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] yt-dlp alternative output: ${output.trim()}`);
          }
          
          // Extrair informações de progresso
          const match = output.match(progressRegex);
          if (match && match[1]) {
            const percent = parseFloat(match[1]);
            
            // Atualizar progresso
            this.updateJobProgress(jobId, 'download', percent);
            
            // Log progress every 5 seconds if verbose
            const now = Date.now();
            if (config.verbose && (now - lastLogTime > 5000)) {
              lastLogTime = now;
              console.log(`[Job ${jobId}] Download progress (alternative): ${percent.toFixed(1)}%`);
            }
          }
        });
        
        ytDlpProcess.stderr.on('data', (data) => {
          const output = data.toString();
          if (config.verbose) {
            console.log(`[Job ${jobId}] yt-dlp alternative stderr: ${output.trim()}`);
          }
        });
        
        ytDlpProcess.on('close', (code) => {
          if (code === 0) {
            if (config.verbose) console.log(`[Job ${jobId}] yt-dlp alternative process completed successfully`);
            
            // Verificar se o arquivo foi criado
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              if (config.verbose) {
                console.log(`[Job ${jobId}] Audio file downloaded (alternative):`, {
                  path: outputPath,
                  size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                  created: stats.birthtime
                });
              }
              
              this.updateJobProgress(jobId, 'download', 100);
              resolve();
            } else {
              const error = new Error(`Audio file not created: ${outputPath}`);
              console.error(`[Job ${jobId}] ${error.message}`);
              reject(error);
            }
          } else {
            const error = new Error(`yt-dlp alternative process exited with code ${code}`);
            console.error(`[Job ${jobId}] ${error.message}`);
            reject(error);
          }
        });
        
        ytDlpProcess.on('error', (err) => {
          console.error(`[Job ${jobId}] Error in yt-dlp alternative process:`, err);
          reject(new Error(`yt-dlp alternative error: ${err.message}`));
        });
        
      } catch (error) {
        console.error(`[Job ${jobId}] Unexpected error in downloadWithYtDlpAlternative:`, error);
        reject(error);
      }
    });
  }

  private async downloadWithYtdlCore(jobId: string, videoUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (config.verbose) console.log(`[Job ${jobId}] Tentando download com ytdl-core para: ${videoUrl}`);
      this.updateJobStatus(jobId, 'downloading');
      
      try {
        // Garantir que o diretório de saída existe
        const audioDir = path.dirname(outputPath);
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        
        // Obter informações do vídeo
        ytdl.getInfo(videoUrl).then(info => {
          if (config.verbose) console.log(`[Job ${jobId}] Informações do vídeo obtidas com sucesso`);
          
          // Selecionar o formato de áudio de melhor qualidade
          const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
          const bestAudio = audioFormats.sort((a, b) => {
            const aBitrate = a.audioBitrate || 0;
            const bBitrate = b.audioBitrate || 0;
            return bBitrate - aBitrate;
          })[0];
          
          if (!bestAudio) {
            const error = new Error('Nenhum formato de áudio encontrado');
            console.error(`[Job ${jobId}] ${error.message}`);
            reject(error);
            return;
          }
          
          if (config.verbose) {
            console.log(`[Job ${jobId}] Melhor formato de áudio selecionado:`, {
              itag: bestAudio.itag,
              container: bestAudio.container,
              quality: bestAudio.audioQuality,
              bitrate: bestAudio.audioBitrate
            });
          }
          
          // Iniciar o download
          const stream = ytdl(videoUrl, { 
            quality: bestAudio.itag,
            requestOptions: {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
              }
            }
          });
          
          let lastPercent = 0;
          let lastLogTime = Date.now();
          let totalBytes = 0;
          let downloadedBytes = 0;
          
          // Obter tamanho total do arquivo
          if (bestAudio.contentLength) {
            totalBytes = parseInt(bestAudio.contentLength);
            if (config.verbose) console.log(`[Job ${jobId}] Tamanho total do arquivo: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
          }
          
          // Monitorar progresso do download
          stream.on('progress', (_, downloaded, total) => {
            if (total) totalBytes = total;
            downloadedBytes = downloaded;
            
            const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
            
            // Atualizar progresso apenas se mudar
            if (percent > lastPercent) {
              lastPercent = percent;
              this.updateJobProgress(jobId, 'download', percent);
              
              // Log progress every 5 seconds if verbose
              const now = Date.now();
              if (config.verbose && (now - lastLogTime > 5000)) {
                lastLogTime = now;
                console.log(`[Job ${jobId}] Download progress (ytdl-core): ${percent}%`);
              }
            }
          });
          
          // Criar arquivo de saída diretamente
          const outputFileStream = fs.createWriteStream(outputPath);
          
          // Conectar o stream ao arquivo de saída
          stream.pipe(outputFileStream);
          
          // Gerenciar erros do stream
          stream.on('error', (err: Error) => {
            console.error(`[Job ${jobId}] Erro no download:`, err.message);
            reject(new Error(`Erro no download: ${err.message}`));
          });
          
          // Quando o download for concluído
          outputFileStream.on('finish', () => {
            if (config.verbose) console.log(`[Job ${jobId}] Download concluído com sucesso`);
            
            // Verificar se o arquivo foi criado
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              if (config.verbose) {
                console.log(`[Job ${jobId}] Arquivo de áudio baixado (ytdl-core):`, {
                  path: outputPath,
                  size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                  created: stats.birthtime
                });
              }
              
              this.updateJobProgress(jobId, 'download', 100);
              resolve();
            } else {
              const error = new Error(`Arquivo de áudio não criado: ${outputPath}`);
              console.error(`[Job ${jobId}] ${error.message}`);
              reject(error);
            }
          });
          
          // Gerenciar erros do arquivo de saída
          outputFileStream.on('error', (err: Error) => {
            console.error(`[Job ${jobId}] Erro ao salvar arquivo:`, err.message);
            reject(new Error(`Erro ao salvar arquivo: ${err.message}`));
          });
          
        }).catch(err => {
          console.error(`[Job ${jobId}] Erro ao obter informações do vídeo:`, err.message);
          reject(new Error(`Erro ao obter informações do vídeo: ${err.message}`));
        });
        
      } catch (error) {
        console.error(`[Job ${jobId}] Erro inesperado no downloadWithYtdlCore:`, error);
        reject(error);
      }
    });
  }

  private async uploadAudio(audioPath: string): Promise<string> {
    if (config.verbose) console.log(`Uploading audio file: ${audioPath}`);
    
    try {
      // Check if file exists and get size
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }
      
      const stats = fs.statSync(audioPath);
      if (config.verbose) {
        console.log(`Audio file details:`, {
          size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
          created: stats.birthtime,
          path: audioPath
        });
      }
      
      const audioFile = fs.readFileSync(audioPath);
      if (config.verbose) console.log(`Read ${audioFile.length} bytes from audio file, sending to AssemblyAI...`);
      
      const startTime = Date.now();
      const response = await axios.post('https://api.assemblyai.com/v2/upload', audioFile, {
        headers: {
          'authorization': this.apiKey,
          'content-type': 'application/octet-stream'
        }
      });
      
      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      if (config.verbose) console.log(`Audio upload completed in ${uploadTime}s. Upload URL: ${response.data.upload_url}`);
      
      return response.data.upload_url;
    } catch (error: any) {
      console.error(`Error uploading audio:`, error);
      throw new Error(`Failed to upload audio: ${error.message}`);
    }
  }

  private async startTranscriptionJob(audioUrl: string): Promise<string> {
    if (config.verbose) console.log(`Starting transcription job for audio: ${audioUrl}`);
    
    try {
      const startTime = Date.now();
      const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
        audio_url: audioUrl,
        speaker_labels: true,
        language_code: 'pt'
      }, {
        headers: {
          'authorization': this.apiKey,
          'content-type': 'application/json'
        }
      });
      
      const requestTime = ((Date.now() - startTime) / 1000).toFixed(2);
      if (config.verbose) console.log(`Transcription job created in ${requestTime}s. Transcript ID: ${response.data.id}`);
      
      return response.data.id;
    } catch (error: any) {
      console.error(`Error starting transcription job:`, error);
      throw new Error(`Failed to start transcription: ${error.message}`);
    }
  }

  private async waitForTranscriptionCompletion(jobId: string, transcriptId: string): Promise<any> {
    if (config.verbose) console.log(`[Job ${jobId}] Waiting for transcription completion. ID: ${transcriptId}`);
    
    let completed = false;
    let pollCount = 0;
    let lastProgress = 0;
    let startTime = Date.now();
    
    while (!completed) {
      pollCount++;
      if (config.verbose) console.log(`[Job ${jobId}] Polling attempt ${pollCount} for transcript status...`);
      
      try {
        const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: {
            'authorization': this.apiKey
          }
        });
        
        const result = response.data;
        
        if (config.verbose) {
          console.log(`[Job ${jobId}] Transcript status: ${result.status}`, {
            percentComplete: result.percent_complete || 0,
            duration: result.audio_duration ? result.audio_duration + 's' : 'Unknown',
            wordCount: result.words ? result.words.length : 0,
            elapsedTime: ((Date.now() - startTime) / 1000).toFixed(0) + 's'
          });
        }
        
        if (result.status === 'completed') {
          completed = true;
          this.updateJobProgress(jobId, 'transcription', 100);
          if (config.verbose) {
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
            console.log(`[Job ${jobId}] Transcription completed in ${totalTime}s`);
          }
          return result;
        } else if (result.status === 'error') {
          const errorMsg = `Transcription error: ${result.error}`;
          console.error(`[Job ${jobId}] ${errorMsg}`);
          throw new Error(errorMsg);
        } else {
          // Update progress
          const percent = result.percent_complete || 0;
          
          // Only update if progress has changed significantly
          if (Math.abs(percent - lastProgress) > 5) {
            lastProgress = percent;
            this.updateJobProgress(jobId, 'transcription', percent);
            if (config.verbose) console.log(`[Job ${jobId}] Updated transcription progress: ${percent}%`);
          }
          
          // Wait before checking again
          if (config.verbose) console.log(`[Job ${jobId}] Waiting 3 seconds before next poll...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error: any) {
        console.error(`[Job ${jobId}] Error polling transcript status:`, error);
        // If we get an error, wait a bit longer before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Don't throw here, just continue the loop to retry
      }
    }
  }

  private async saveTranscript(
    transcript: any, 
    transcriptPath: string, 
    simplePath: string,
    videoTitle: string,
    videoUrl: string
  ): Promise<void> {
    if (config.verbose) console.log(`Saving transcript to ${transcriptPath} and ${simplePath}`);
    
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(transcriptPath);
      if (!fs.existsSync(dir)) {
        if (config.verbose) console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Format utterances
      if (config.verbose) console.log(`Formatting utterances...`);
      const utterances = this.formatUtterances(transcript);
      
      // Format timestamps
      if (config.verbose) console.log(`Formatting timestamps...`);
      const timestamps = this.formatTimestamps(transcript);
      
      // Format full transcript
      if (config.verbose) console.log(`Creating full transcript...`);
      const fullTranscript = [
        "=".repeat(50),
        `TRANSCRIÇÃO DO VÍDEO: ${videoTitle}`,
        `URL: ${videoUrl}`,
        "=".repeat(50) + "\n",
        "=== INFORMAÇÕES DA TRANSCRIÇÃO ===\n",
        `Data da transcrição: ${new Date().toISOString()}`,
        `Duração total: ${this.formatTime(transcript.audio_duration)}`,
        "\n" + "=".repeat(50) + "\n",
        "=== TRANSCRIÇÃO POR FALANTES ===\n",
        utterances,
        "\n" + "=".repeat(50) + "\n",
        "=== TRANSCRIÇÃO COM TIMESTAMPS ===\n",
        timestamps,
        "\n" + "=".repeat(50) + "\n",
        "=== TEXTO COMPLETO ===\n",
        transcript.text,
        "\n\n" + "=".repeat(50)
      ].join('\n');
      
      // Write files
      if (config.verbose) console.log(`Writing transcripts to disk...`);
      fs.writeFileSync(transcriptPath, fullTranscript, 'utf8');
      fs.writeFileSync(simplePath, utterances, 'utf8');
      
      if (config.verbose) {
        console.log(`Transcripts saved successfully:`, {
          fullPath: transcriptPath,
          simplePath: simplePath,
          fullSize: fs.statSync(transcriptPath).size,
          simpleSize: fs.statSync(simplePath).size
        });
      }
    } catch (error: any) {
      console.error(`Error saving transcript:`, error);
      throw new Error(`Failed to save transcript: ${error.message}`);
    }
  }

  private formatUtterances(transcript: any): string {
    if (!transcript.utterances || transcript.utterances.length === 0) {
      return "Não foram encontradas utterances na transcrição.";
    }
    
    let formatted = [];
    let currentSpeaker = null;
    let currentText: string[] = [];
    
    for (const utterance of transcript.utterances) {
      const speaker = utterance.speaker || 'Unknown';
      const text = utterance.text?.trim() || '';
      
      if (currentSpeaker !== speaker && currentText.length > 0) {
        formatted.push(`Falante ${currentSpeaker}:\n${currentText.join(' ')}\n`);
        currentText = [];
      }
      
      currentSpeaker = speaker;
      currentText.push(text);
    }
    
    if (currentText.length > 0) {
      formatted.push(`Falante ${currentSpeaker}:\n${currentText.join(' ')}\n`);
    }
    
    return formatted.join('\n');
  }

  private formatTimestamps(transcript: any): string {
    if (!transcript.words || transcript.words.length === 0) {
      return "Não foram encontrados timestamps na transcrição.";
    }
    
    return transcript.words.map((word: any) => {
      const start = this.formatTime(word.start);
      const end = this.formatTime(word.end);
      return `[${start} - ${end}] ${word.text}`;
    }).join('\n');
  }

  private formatTime(ms: number): string {
    const seconds = ms / 1000;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
  }

  private updateJobStatus(
    jobId: string, 
    status: TranscriptionJob['status'], 
    error?: string,
    result?: TranscriptionJob['result']
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      if (error) job.error = error;
      if (result) job.result = result;
      
      this.io.emit('job_update', job);
    }
  }

  private updateJobProgress(jobId: string, type: 'download' | 'transcription', percent: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress[type] = percent;
      this.io.emit('job_update', job);
    }
  }
}
