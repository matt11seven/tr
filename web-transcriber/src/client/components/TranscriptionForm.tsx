import React, { useState } from 'react';

interface Props {
  onSubmit: (videoUrl: string) => void;
}

const TranscriptionForm: React.FC<Props> = ({ onSubmit }) => {
  const [videoUrl, setVideoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!videoUrl.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(videoUrl);
      setVideoUrl('');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <form className="transcription-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="videoUrl">URL do Vídeo do YouTube</label>
        <input
          type="text"
          id="videoUrl"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=VIDEO_ID"
          required
          disabled={isSubmitting}
        />
      </div>
      
      <button type="submit" disabled={isSubmitting || !videoUrl.trim()}>
        {isSubmitting ? 'Processando...' : 'Transcrever Vídeo'}
      </button>
      
      <div className="form-help">
        <p>Formatos aceitos:</p>
        <ul>
          <li>https://www.youtube.com/watch?v=VIDEO_ID</li>
          <li>https://youtu.be/VIDEO_ID</li>
        </ul>
      </div>
    </form>
  );
};

export default TranscriptionForm;
