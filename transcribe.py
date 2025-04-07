import os
import sys
import os
import asyncio
import logging
import time
import argparse
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
from dataclasses import dataclass
import aiohttp
import yt_dlp
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class TranscriptionError(Exception):
    """Exceção base para erros de transcrição."""
    pass

class DownloadError(TranscriptionError):
    """Erro durante o download do vídeo."""
    pass

class UploadError(TranscriptionError):
    """Erro durante o upload do áudio."""
    pass

class APIError(TranscriptionError):
    """Erro na comunicação com a API."""
    pass

@dataclass
class Config:
    """Configuração da aplicação."""
    api_key: str
    ffmpeg_path: Path
    check_interval: int = 30
    timeout: int = 36000
    chunk_size: int = 5242880

    @classmethod
    def from_env(cls) -> 'Config':
        """Cria configuração a partir de variáveis de ambiente."""
        load_dotenv()
        api_key = os.getenv('ASSEMBLYAI_API_KEY')
        ffmpeg_path = os.getenv('FFMPEG_PATH')

        if not api_key:
            raise ValueError("ASSEMBLYAI_API_KEY não encontrada no arquivo .env")
        if not ffmpeg_path:
            raise ValueError("FFMPEG_PATH não encontrado no arquivo .env")
        if not os.path.exists(ffmpeg_path):
            raise ValueError(f"FFMPEG não encontrado no caminho: {ffmpeg_path}")

        return cls(api_key=api_key, ffmpeg_path=Path(ffmpeg_path))

class ProgressTracker:
    """Rastreador de progresso genérico."""
    def __init__(self, description: str):
        self.description = description
        self.last_percent = 0

    def update(self, percent: float):
        """Atualiza o progresso."""
        if int(percent) > self.last_percent:
            self.last_percent = int(percent)
            print(f"\r{self.description}: {self.last_percent}% concluído", end='', flush=True)

    def complete(self):
        """Marca como completo."""
        print(f"\n{self.description} concluído!")

class YouTubeDownloader:
    """Gerenciador de download de vídeos do YouTube."""
    def __init__(self, ffmpeg_path: Path):
        self.ffmpeg_path = ffmpeg_path
        self.progress = ProgressTracker("Download")

    def progress_hook(self, d: Dict[str, Any]):
        """Hook de progresso para yt-dlp."""
        if d['status'] == 'downloading':
            total_bytes = d.get('total_bytes')
            downloaded_bytes = d.get('downloaded_bytes', 0)
            if total_bytes:
                self.progress.update((downloaded_bytes / total_bytes) * 100)
        elif d['status'] == 'finished':
            self.progress.complete()
            print("Iniciando extração do áudio...")
        elif d['status'] == 'error':
            raise DownloadError(f"Erro no download: {d.get('error')}")

    async def download(self, video_id: str) -> Tuple[str, str]:
        """Download assíncrono do vídeo."""
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        
        try:
            title = await self.get_video_title(video_id)
            if not title:
                raise DownloadError("Não foi possível obter o título do vídeo")

            audio_path = f"audios/{title}.mp3"
            transcript_path = f"transcricoes/{title}.txt"

            os.makedirs("audios", exist_ok=True)
            os.makedirs("transcricoes", exist_ok=True)

            if os.path.exists(transcript_path):
                logger.info(f"Transcrição já existe: {transcript_path}")
                return audio_path, transcript_path

            if not os.path.exists(audio_path):
                await self._download_audio(video_url, audio_path)

            return audio_path, transcript_path

        except Exception as e:
            raise DownloadError(f"Erro ao baixar vídeo: {str(e)}")

    async def get_video_title(self, video_id: str) -> Optional[str]:
        """Obtém o título do vídeo."""
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}",
                    download=False
                )
                return "".join(c for c in info['title'] if c.isalnum() or c in (' ', '-', '_'))
        except Exception as e:
            logger.error(f"Erro ao obter título do vídeo: {e}")
            return None

    async def _download_audio(self, video_url: str, output_path: str):
        """Download do áudio do vídeo."""
        output_template = os.path.splitext(output_path)[0]
        ydl_opts = {
            'ffmpeg_location': str(self.ffmpeg_path),
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': output_template,
            'progress_hooks': [self.progress_hook],
            'quiet': True,
            'no_warnings': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

class Transcriber:
    """Gerenciador de transcrição usando AssemblyAI."""
    def __init__(self, config: Config):
        self.config = config
        self.headers = {
            "authorization": config.api_key,
            "content-type": "application/json"
        }
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        """Contexto assíncrono para gerenciar a sessão HTTP."""
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Limpeza do contexto assíncrono."""
        if self.session:
            await self.session.close()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def upload_audio(self, audio_path: str) -> str:
        """Upload do arquivo de áudio com retry."""
        if not os.path.exists(audio_path):
            raise UploadError(f"Arquivo não encontrado: {audio_path}")

        try:
            logger.info(f"Iniciando upload: {audio_path}")
            data = aiohttp.FormData()
            data.add_field('file', open(audio_path, 'rb'))

            async with self.session.post(
                'https://api.assemblyai.com/v2/upload',
                headers=self.headers,
                data=data
            ) as response:
                response.raise_for_status()
                result = await response.json()
                return result['upload_url']

        except Exception as e:
            raise UploadError(f"Erro no upload: {str(e)}")

    async def transcribe(self, audio_path: str, transcript_path: str, video_id: str) -> Dict[str, Any]:
        """Processo completo de transcrição."""
        try:
            upload_url = await self.upload_audio(audio_path)
            logger.info(f"Upload concluído: {upload_url}")

            transcript_id = await self._start_transcription(upload_url)
            result = await self._wait_for_completion(transcript_id)
            
            await self._save_transcript(result, transcript_path, video_id)
            return result

        finally:
            try:
                os.remove(audio_path)
                logger.info(f"Áudio removido: {audio_path}")
            except Exception as e:
                logger.error(f"Erro ao remover áudio: {e}")

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def _start_transcription(self, audio_url: str) -> str:
        """Inicia o processo de transcrição."""
        json_data = {
            "audio_url": audio_url,
            "speaker_labels": True,
            "language_code": "pt"
        }

        async with self.session.post(
            'https://api.assemblyai.com/v2/transcript',
            json=json_data,
            headers=self.headers
        ) as response:
            response.raise_for_status()
            result = await response.json()
            return result['id']

    async def _wait_for_completion(self, transcript_id: str) -> Dict[str, Any]:
        """Aguarda a conclusão da transcrição."""
        progress = ProgressTracker("Transcrição")
        start_time = time.time()

        while True:
            if time.time() - start_time > self.config.timeout:
                raise APIError("Timeout na transcrição")

            async with self.session.get(
                f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                headers=self.headers
            ) as response:
                response.raise_for_status()
                result = await response.json()

            status = result['status']
            if status == 'completed':
                progress.complete()
                return result
            elif status == 'error':
                raise APIError(f"Erro na transcrição: {result.get('error')}")
            elif status == 'processing':
                progress.update(result.get('percentage_complete', 0))

            await asyncio.sleep(self.config.check_interval)

    @staticmethod
    def _format_time(ms: int) -> str:
        """Formata tempo em milissegundos."""
        seconds = ms / 1000
        minutes = int(seconds // 60)
        seconds = seconds % 60
        return f"{minutes:02d}:{seconds:05.2f}"

    async def _save_transcript(self, transcript: Dict[str, Any], path: str, video_id: str):
        """Salva a transcrição em arquivos."""
        try:
            video_url = f"https://www.youtube.com/watch?v={video_id}"
            
            # Arquivo detalhado
            async with aiohttp.ClientSession() as session:
                async with session.get(video_url) as response:
                    video_title = await response.text()

            content = [
                "=" * 50,
                f"TRANSCRIÇÃO DO VÍDEO: {video_title}",
                f"URL: {video_url}",
                "=" * 50 + "\n",
                "=== INFORMAÇÕES ===\n",
                f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                f"Duração: {self._format_time(transcript.get('audio_duration', 0))}",
                "=" * 50 + "\n",
                "=== TRANSCRIÇÃO POR FALANTES ===\n",
                self._format_utterances(transcript),
                "=" * 50 + "\n",
                "=== TIMESTAMPS ===\n",
                self._format_timestamps(transcript),
                "=" * 50 + "\n",
                "=== TEXTO COMPLETO ===\n",
                transcript['text'],
                "\n" + "=" * 50
            ]

            # Salva arquivo detalhado
            with open(path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(content))

            # Salva arquivo simplificado
            simple_path = path.replace('.txt', '_simples.txt')
            with open(simple_path, 'w', encoding='utf-8') as f:
                f.write(self._format_utterances(transcript))

            logger.info(f"Transcrições salvas:\n- Detalhada: {path}\n- Simples: {simple_path}")

        except Exception as e:
            raise TranscriptionError(f"Erro ao salvar transcrição: {str(e)}")

    def _format_utterances(self, transcript: Dict[str, Any]) -> str:
        """Formata transcrição por falantes."""
        if not transcript.get('utterances'):
            return "Sem utterances disponíveis."

        formatted = []
        current_speaker = None
        current_text = []

        for utterance in transcript['utterances']:
            speaker = utterance.get('speaker', 'Unknown')
            text = utterance.get('text', '').strip()

            if current_speaker != speaker and current_text:
                formatted.append(f"Falante {current_speaker}:\n{' '.join(current_text)}\n")
                current_text = []

            current_speaker = speaker
            current_text.append(text)

        if current_text:
            formatted.append(f"Falante {current_speaker}:\n{' '.join(current_text)}\n")

        return "\n".join(formatted)

    def _format_timestamps(self, transcript: Dict[str, Any]) -> str:
        """Formata timestamps."""
        if not transcript.get('words'):
            return "Sem timestamps disponíveis."

        return "\n".join(
            f"[{self._format_time(word['start'])} - {self._format_time(word['end'])}] {word['text']}"
            for word in transcript['words']
        )

async def main():
    """Função principal assíncrona."""
    # Configurar argumentos de linha de comando
    parser = argparse.ArgumentParser(description='Transcribe YouTube videos')
    parser.add_argument('--mode', choices=['interactive', 'download-only'], default='interactive',
                        help='Modo de operação: interativo ou apenas download')
    parser.add_argument('--video-id', help='ID do vídeo do YouTube')
    parser.add_argument('--output', help='Caminho de saída para o arquivo de áudio')
    
    args = parser.parse_args()
    
    try:
        config = Config.from_env()
        
        # Modo download-only (para ser chamado pelo código TypeScript)
        if args.mode == 'download-only':
            if not args.video_id or not args.output:
                logger.error("No modo download-only, você deve fornecer --video-id e --output")
                sys.exit(1)
                
            try:
                video_id = args.video_id
                output_path = args.output
                
                # Verificar se o diretório de áudio existe
                audio_dir = os.path.dirname(output_path)
                if not os.path.exists(audio_dir):
                    os.makedirs(audio_dir, exist_ok=True)
                
                # Download do vídeo usando o método direto
                print(f"Iniciando download do vídeo: {video_id}")
                downloader = YouTubeDownloader(config.ffmpeg_path)
                await downloader._download_audio(f"https://www.youtube.com/watch?v={video_id}", output_path)
                
                print(f"Download concluído: {output_path}")
                return
                
            except Exception as e:
                logger.error(f"Erro no download: {e}")
                sys.exit(1)
        
        # Modo interativo (original)
        print("\n=== TRANSCRIÇÃO DE VÍDEO DO YOUTUBE ===")
        print("\nDigite a URL do YouTube ou o ID do vídeo")
        print("Exemplos válidos:")
        print("- https://www.youtube.com/watch?v=VIDEO_ID")
        print("- https://youtu.be/VIDEO_ID")
        print("- VIDEO_ID")
        
        video_input = input("\nURL ou ID: ").strip()

        try:
            # Extrai ID do vídeo
            if 'youtube.com' in video_input:
                video_id = video_input.split('watch?v=')[1].split('&')[0]
            elif 'youtu.be' in video_input:
                video_id = video_input.split('youtu.be/')[1].split('?')[0]
            else:
                video_id = video_input

            # Download do vídeo
            downloader = YouTubeDownloader(config.ffmpeg_path)
            audio_path, transcript_path = await downloader.download(video_id)

            # Verifica transcrição existente
            if os.path.exists(transcript_path):
                reprocess = input("\nTranscrição já existe. Reprocessar? (s/N): ").strip().lower()
                if reprocess != 's':
                    print("\nUsando transcrição existente:")
                    with open(transcript_path, 'r', encoding='utf-8') as f:
                        print(f.read())
                    return

            # Transcrição
            async with Transcriber(config) as transcriber:
                await transcriber.transcribe(audio_path, transcript_path, video_id)

            print("\nProcesso concluído com sucesso!")

        except TranscriptionError as e:
            logger.error(f"Erro na transcrição: {e}")
        except Exception as e:
            logger.error(f"Erro inesperado: {e}")
            
    except ValueError as e:
        logger.error(f"Erro de configuração: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
