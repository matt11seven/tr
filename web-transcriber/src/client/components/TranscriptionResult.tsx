import React, { useState, useEffect } from 'react';

interface Props {
  transcriptPath: string;
  simplePath: string;
}

const TranscriptionResult: React.FC<Props> = ({ transcriptPath, simplePath }) => {
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    const fetchTranscript = async () => {
      try {
        const filename = simplePath.split('/').pop();
        const response = await fetch(`/api/download/${filename}`);
        const text = await response.text();
        setTranscriptContent(text);
      } catch (error) {
        console.error('Error fetching transcript:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchTranscript();
  }, [simplePath]);
  
  const handleDownload = (path: string) => {
    const filename = path.split('/').pop();
    window.open(`/api/download/${filename}`, '_blank');
  };
  
  return (
    <div className="transcription-result">
      <h3>Transcrição Concluída!</h3>
      
      <div className="download-buttons">
        <button onClick={() => handleDownload(simplePath)}>
          Baixar Transcrição Simples
        </button>
        <button onClick={() => handleDownload(transcriptPath)}>
          Baixar Transcrição Completa
        </button>
      </div>
      
      <div className="transcript-preview">
        <h4>Prévia da Transcrição:</h4>
        {isLoading ? (
          <p>Carregando prévia...</p>
        ) : (
          <pre>{transcriptContent.substring(0, 1000)}...</pre>
        )}
      </div>
    </div>
  );
};

export default TranscriptionResult;
