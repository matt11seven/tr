#!/bin/sh

# Script de inicialização para configurar o ambiente corretamente

echo "Iniciando configuração do ambiente..."

# Verificar instalação do ffmpeg
if [ -f "/usr/bin/ffmpeg" ]; then
  echo "FFmpeg encontrado em /usr/bin/ffmpeg"
  export FFMPEG_PATH="/usr/bin/ffmpeg"
else
  echo "ERRO: FFmpeg não encontrado!"
  exit 1
fi

# Verificar instalação do yt-dlp
echo "Verificando instalação do yt-dlp..."
if python3 -m yt_dlp --version > /dev/null 2>&1; then
  echo "yt-dlp instalado corretamente"
else
  echo "Tentando reinstalar yt-dlp..."
  pip3 install --upgrade yt-dlp
  
  if python3 -m yt_dlp --version > /dev/null 2>&1; then
    echo "yt-dlp reinstalado com sucesso"
  else
    echo "ERRO: Falha ao instalar yt-dlp"
    exit 1
  fi
fi

# Criar diretórios necessários
mkdir -p audios transcricoes
echo "Diretórios criados: audios, transcricoes"

# Configurar variáveis de ambiente
export NODE_ENV=production
export FFMPEG_PATH="/usr/bin/ffmpeg"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "Ambiente configurado com sucesso"
echo "Iniciando servidor..."

# Iniciar o servidor
node dist/server/index.js
