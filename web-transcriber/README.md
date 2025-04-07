# YouTube Transcriber

Uma aplicação web para transcrever vídeos do YouTube com detecção de falantes usando AssemblyAI.

## Características

- Interface web moderna e responsiva construída com React e TypeScript
- Download de vídeos do YouTube usando ytdl-core
- Extração de áudio com ffmpeg
- Transcrição com detecção de falantes usando AssemblyAI
- Atualizações em tempo real do progresso via Socket.IO
- Armazenamento de transcrições em formatos detalhado e simplificado
- Docker e Docker Compose para fácil implantação

## Requisitos

- Node.js 16+
- FFmpeg
- Conta AssemblyAI com API Key

## Estrutura do Projeto

```
web-transcriber/
├── src/
│   ├── server/          # Código do servidor Node.js/Express
│   └── client/          # Código do cliente React
├── Dockerfile           # Configuração do Docker
├── docker-compose.yml   # Configuração do Docker Compose
├── .env.example         # Exemplo de variáveis de ambiente
└── README.md            # Este arquivo
```

## Configuração Local

1. Clone o repositório:
   ```
   git clone https://github.com/seu-usuario/youtube-transcriber.git
   cd youtube-transcriber
   ```

2. Instale as dependências:
   ```
   npm install
   ```

3. Copie o arquivo `.env.example` para `.env` e configure suas variáveis:
   ```
   cp .env.example .env
   ```

4. Edite o arquivo `.env` e adicione sua API key do AssemblyAI.

5. Construa o projeto:
   ```
   npm run build
   ```

6. Inicie o servidor:
   ```
   npm start
   ```

7. Acesse a aplicação em `http://localhost:3000`

## Implantação com Docker

1. Construa a imagem Docker:
   ```
   docker build -t youtube-transcriber .
   ```

2. Execute o contêiner:
   ```
   docker run -p 3000:3000 -e ASSEMBLYAI_API_KEY=sua_api_key youtube-transcriber
   ```

## Implantação com Docker Compose

1. Configure sua API key no arquivo `.env` ou como variável de ambiente.

2. Execute com Docker Compose:
   ```
   docker-compose up -d
   ```

## Implantação com Easypanel

1. Faça login no seu servidor Easypanel.

2. Clique em "Novo Projeto" e selecione "Docker Compose".

3. Forneça um nome para o projeto (ex: "youtube-transcriber").

4. Cole o conteúdo do arquivo `docker-compose.yml` no editor.

5. Adicione a variável de ambiente `ASSEMBLYAI_API_KEY` com sua chave API.

6. Clique em "Implantar".

7. Após a implantação, configure o domínio nas configurações do projeto.

## Variáveis de Ambiente

- `ASSEMBLYAI_API_KEY`: Sua chave API do AssemblyAI (obrigatória)
- `FFMPEG_PATH`: Caminho para o executável do FFmpeg (padrão: `/usr/bin/ffmpeg` no Linux)
- `PORT`: Porta para o servidor web (padrão: 3000)
- `NODE_ENV`: Ambiente Node.js (padrão: production)
- `SECRET_KEY`: Chave secreta para sessões (recomendado alterar)

## Volumes de Dados

O aplicativo usa dois volumes Docker para armazenar dados:

- `audio_data`: Armazena arquivos de áudio temporários
- `transcript_data`: Armazena arquivos de transcrição

## Notas para Implantação em Produção

1. Sempre use HTTPS em produção.
2. Configure um proxy reverso como Nginx ou Traefik.
3. Considere adicionar autenticação para proteger o acesso.
4. Monitore o uso de disco, pois os arquivos de áudio podem ocupar espaço.

## Licença

MIT
