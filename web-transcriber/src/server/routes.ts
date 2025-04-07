import { Express } from 'express';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { Transcriber } from './transcriber';

export function setupRoutes(app: Express, io: Server): void {
  const transcriber = new Transcriber(io);
  
  // API routes
  app.post('/api/transcribe', async (req, res) => {
    try {
      const { videoUrl } = req.body;
      
      if (!videoUrl) {
        return res.status(400).json({ error: 'Video URL is required' });
      }
      
      const jobId = await transcriber.startTranscription(videoUrl);
      res.json({ jobId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/jobs', (req, res) => {
    const jobs = transcriber.getAllJobs();
    res.json({ jobs });
  });
  
  app.get('/api/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = transcriber.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({ job });
  });
  
  app.get('/api/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'transcricoes', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath);
  });
  
  // Serve React app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
  });
}
