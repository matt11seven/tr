import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ytdl from 'ytdl-core';
import { v4 as uuidv4 } from 'uuid';
import { Server } from 'socket.io';

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
    this.apiKey = process.env.ASSEMBLYAI_API_KEY || '';
    this.ffmpegPath = process.env.FFMPEG_PATH || '';
    
    // Create directories if they don't exist
    if (!fs.existsSync('audios')) {
      fs.mkdirSync('audios');
    }
    if (!fs.existsSync('transcricoes')) {
      fs.mkdirSync('transcricoes');
    }
    
    // Set ffmpeg path
    ffmpeg.setFfmpegPath(this.ffmpegPath);
  }

  public async startTranscription(videoUrl: string): Promise<string> {
    // Validate inputs
    if (!this.apiKey) {
      throw new Error('AssemblyAI API key not found');
    }
    
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg path not found');
    }
    
    if (!ytdl.validateURL(videoUrl)) {
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
      // Get video info
      const videoInfo = await ytdl.getInfo(videoUrl);
      const videoTitle = videoInfo.videoDetails.title.replace(/[^a-zA-Z0-9\s-_]/g, '');
      
      // Set file paths
      const audioPath = path.join('audios', `${videoTitle}.mp3`);
      const transcriptPath = path.join('transcricoes', `${videoTitle}.txt`);
      const simplePath = path.join('transcricoes', `${videoTitle}_simples.txt`);
      
      // Check if transcript already exists
      if (fs.existsSync(transcriptPath)) {
        this.updateJobStatus(jobId, 'completed', undefined, {
          transcriptPath,
          simplePath
        });
        return;
      }
      
      // Download video
      await this.downloadVideo(jobId, videoUrl, audioPath);
      
      // Transcribe audio
      await this.transcribeAudio(jobId, audioPath, transcriptPath, simplePath, videoTitle, videoUrl);
      
      // Update job status
      this.updateJobStatus(jobId, 'completed', undefined, {
        transcriptPath,
        simplePath
      });
      
      // Clean up audio file
      fs.unlinkSync(audioPath);
      
    } catch (error: any) {
      this.updateJobStatus(jobId, 'error', error.message);
    }
  }

  private async downloadVideo(jobId: string, videoUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.updateJobStatus(jobId, 'downloading');
      
      const video = ytdl(videoUrl, { quality: 'highestaudio' });
      let totalBytes = 0;
      let downloadedBytes = 0;
      
      video.on('info', (info, format) => {
        totalBytes = parseInt(format.contentLength, 10);
      });
      
      video.on('progress', (_, downloaded, total) => {
        if (total) {
          downloadedBytes = downloaded;
          const percent = Math.floor((downloaded / total) * 100);
          this.updateJobProgress(jobId, 'download', percent);
        }
      });
      
      const ffmpegProcess = ffmpeg(video)
        .audioBitrate(192)
        .save(outputPath)
        .on('end', () => {
          this.updateJobProgress(jobId, 'download', 100);
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`FFmpeg error: ${err.message}`));
        });
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
    this.updateJobStatus(jobId, 'transcribing');
    
    // Upload audio file
    const uploadUrl = await this.uploadAudio(audioPath);
    
    // Start transcription
    const transcriptId = await this.startTranscriptionJob(uploadUrl);
    
    // Wait for completion
    const transcript = await this.waitForTranscriptionCompletion(jobId, transcriptId);
    
    // Save transcript
    await this.saveTranscript(transcript, transcriptPath, simplePath, videoTitle, videoUrl);
  }

  private async uploadAudio(audioPath: string): Promise<string> {
    const audioFile = fs.readFileSync(audioPath);
    
    const response = await axios.post('https://api.assemblyai.com/v2/upload', audioFile, {
      headers: {
        'authorization': this.apiKey,
        'content-type': 'application/octet-stream'
      }
    });
    
    return response.data.upload_url;
  }

  private async startTranscriptionJob(audioUrl: string): Promise<string> {
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
    
    return response.data.id;
  }

  private async waitForTranscriptionCompletion(jobId: string, transcriptId: string): Promise<any> {
    let completed = false;
    
    while (!completed) {
      const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          'authorization': this.apiKey
        }
      });
      
      const result = response.data;
      
      if (result.status === 'completed') {
        completed = true;
        this.updateJobProgress(jobId, 'transcription', 100);
        return result;
      } else if (result.status === 'error') {
        throw new Error(`Transcription error: ${result.error}`);
      } else {
        // Update progress
        const percent = result.percentage_complete || 0;
        this.updateJobProgress(jobId, 'transcription', percent);
        
        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 3000));
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
    // Format utterances
    const utterances = this.formatUtterances(transcript);
    
    // Format timestamps
    const timestamps = this.formatTimestamps(transcript);
    
    // Format full transcript
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
    fs.writeFileSync(transcriptPath, fullTranscript, 'utf8');
    fs.writeFileSync(simplePath, utterances, 'utf8');
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
