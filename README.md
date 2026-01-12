# Voice Recognition Alarm Backend

Backend server for the Voice Recognition Alarm System. Handles audio processing via Deepgram API and triggers alarm notifications.

## Features

- ✅ Deepgram speech-to-text integration
- ✅ Configurable trigger words
- ✅ Audio processing endpoint
- ✅ RESTful API
- ✅ Production-ready for Render deployment

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```
PORT=3000
DEEPGRAM_API_KEY=your_api_key_here
TRIGGER_WORDS=alarm,emergency,help,fire
```

4. Start development server:
```bash
npm run dev
```

Or production mode:
```bash
npm start
```

## Deploy to Render

### One-Click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

### Manual Deployment

1. Create a new Web Service on [Render](https://render.com)
2. Connect your Git repository
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add environment variables:
   - `DEEPGRAM_API_KEY` - Your Deepgram API key
   - `TRIGGER_WORDS` - Comma-separated trigger words (optional)

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-13T...",
  "triggerWords": ["alarm", "emergency", "help", "fire"]
}
```

### Process Audio
```
POST /api/process-audio
Content-Type: audio/wav or audio/raw
X-Device-ID: ALM0001 (optional)
```

Send audio data in request body (raw PCM or WAV format).

Response:
```json
{
  "success": true,
  "transcription": "help there is a fire",
  "confidence": 0.95,
  "triggered": true,
  "triggeredWords": ["help", "fire"],
  "processingTime": 1234,
  "timestamp": "2026-01-13T..."
}
```

### Get Configuration
```
GET /api/config
```

Response:
```json
{
  "triggerWords": ["alarm", "emergency", "help", "fire"],
  "model": "nova-2",
  "language": "en"
}
```

### Update Trigger Words
```
POST /api/config/trigger-words
Content-Type: application/json

{
  "words": ["alarm", "fire", "help"]
}
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3000 |
| `DEEPGRAM_API_KEY` | Deepgram API key | Yes | - |
| `TRIGGER_WORDS` | Comma-separated trigger words | No | alarm,emergency,help,fire |

## Audio Format

The backend accepts:
- **WAV format**: Standard WAV files
- **Raw PCM**: 16-bit linear PCM, 16kHz, mono

For raw PCM, set `Content-Type: audio/raw`.

## Architecture

```
Client Browser (mic) → ESP32 Web Server → Backend → Deepgram API
                                              ↓
ESP32 ← Backend (transcription + trigger status)
  ↓
Alarm Trigger (if words match)
```

## Production Considerations

- ✅ CORS enabled for cross-origin requests
- ✅ Error handling and logging
- ✅ Graceful shutdown support
- ✅ 10MB request limit for audio
- ✅ Health check endpoint for monitoring

## License

MIT
