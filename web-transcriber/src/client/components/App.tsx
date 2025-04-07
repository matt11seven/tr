import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import TranscriptionForm from './TranscriptionForm';
import ProgressBar from './ProgressBar';
import TranscriptionResult from './TranscriptionResult';

// Types
export interface Job {
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
  createdAt: string;
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize socket connection
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    
    // Listen for job updates
    newSocket.on('job_update', (updatedJob: Job) => {
      setJobs(prevJobs => {
        const index = prevJobs.findIndex(job => job.id === updatedJob.id);
        if (index >= 0) {
          const newJobs = [...prevJobs];
          newJobs[index] = updatedJob;
          return newJobs;
        } else {
          return [...prevJobs, updatedJob];
        }
      });
      
      // Update active job if it's the one being updated
      if (activeJob && activeJob.id === updatedJob.id) {
        setActiveJob(updatedJob);
      }
    });
    
    // Fetch existing jobs
    fetchJobs();
    
    // Clean up
    return () => {
      newSocket.disconnect();
    };
  }, []);
  
  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  };
  
  const startTranscription = async (videoUrl: string) => {
    try {
      setError(null);
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ videoUrl })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start transcription');
      }
      
      const data = await response.json();
      const jobId = data.jobId;
      
      // Fetch the job details
      const jobResponse = await fetch(`/api/jobs/${jobId}`);
      const jobData = await jobResponse.json();
      
      setActiveJob(jobData.job);
    } catch (error: any) {
      setError(error.message);
    }
  };
  
  return (
    <div className="app-container">
      <header>
        <h1>YouTube Transcriber</h1>
        <p>Transcreva vídeos do YouTube com detecção de falantes</p>
      </header>
      
      <main>
        <TranscriptionForm onSubmit={startTranscription} />
        
        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}
        
        {activeJob && (
          <div className="job-container">
            <h2>Processando: {new URL(activeJob.videoUrl).pathname.split('/').pop()}</h2>
            
            {activeJob.status === 'downloading' && (
              <>
                <h3>Baixando vídeo</h3>
                <ProgressBar percent={activeJob.progress.download} />
              </>
            )}
            
            {activeJob.status === 'transcribing' && (
              <>
                <h3>Transcrevendo áudio</h3>
                <ProgressBar percent={activeJob.progress.transcription} />
              </>
            )}
            
            {activeJob.status === 'completed' && activeJob.result && (
              <TranscriptionResult 
                transcriptPath={activeJob.result.transcriptPath}
                simplePath={activeJob.result.simplePath}
              />
            )}
            
            {activeJob.status === 'error' && (
              <div className="error-message">
                <p>Erro: {activeJob.error}</p>
              </div>
            )}
          </div>
        )}
        
        {jobs.length > 0 && !activeJob && (
          <div className="jobs-history">
            <h2>Transcrições Recentes</h2>
            <ul>
              {jobs.map(job => (
                <li key={job.id} onClick={() => setActiveJob(job)}>
                  <span>{new URL(job.videoUrl).pathname.split('/').pop()}</span>
                  <span className={`status status-${job.status}`}>{job.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
      
      <footer>
        <p>© {new Date().getFullYear()} YouTube Transcriber</p>
      </footer>
    </div>
  );
};

export default App;
