# WebSocket Live Audio Integration

## Overview
The ESP32 is now configured to stream live audio from the INMP441 microphone to your backend server via WebSocket for real-time speech recognition.

## ESP32 Features Added

### 1. I2S Microphone Support
- INMP441 microphone on GPIO 25 (WS), 34 (SD), 22 (SCK)
- 16kHz, 16-bit, mono audio
- Continuous streaming in background task

### 2. WebSocket Client
- Connects to backend at `/ws/audio/{deviceId}`
- Auto-reconnects on disconnection
- Sends binary audio data in real-time
- Receives commands (ALARM, OFF) from server

### 3. New API Endpoints

**Start Microphone Streaming:**
```
POST /api/mic/start
```

**Stop Microphone Streaming:**
```
POST /api/mic/stop
```

**Get Microphone Status:**
```
GET /api/mic/status
Response: {"enabled":true,"connected":true}
```

## Backend Server Integration

Add this code to your `backend/server.js` after the existing setup:

```javascript
const WebSocket = require('ws');
const http = require('http');

// Replace: const app = express();
// With:
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add after existing setup:
const deviceConnections = new Map();
const SAMPLE_RATE = 16000;

wss.on('connection', (ws, req) => {
  const urlPath = req.url;
  const deviceIdMatch = urlPath.match(/\/ws\/audio\/([^/]+)/);
  const deviceId = deviceIdMatch ? deviceIdMatch[1] : 'unknown';
  
  console.log(`\n🎤 [WS] Device ${deviceId} connected`);
  
  let deepgramConnection = null;
  deviceConnections.set(deviceId, ws);
  
  // Initialize Deepgram live transcription
  if (SPEECH_API === 'deepgram') {
    console.log(`[${deviceId}] Starting live transcription...`);
    
    deepgramConnection = deepgram.listen.live({
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      interim_results: false,
      utterance_end_ms: 1000,
      endpointing: 300
    });
    
    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[${deviceId}] Deepgram connected`);
      
      deepgramConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript && transcript.trim().length > 0) {
          console.log(`[${deviceId}] 📝 ${transcript}`);
          
          const lowerTranscript = transcript.toLowerCase();
          const triggered = TRIGGER_WORDS.some(word => {
            const similarity = calculateSimilarity(lowerTranscript, word);
            return lowerTranscript.includes(word) || similarity > 0.8;
          });
          
          if (triggered) {
            console.log(`\n🚨 [${deviceId}] ALARM TRIGGERED: ${transcript}\n`);
            
            deviceResults.set(deviceId, {
              triggered: true,
              transcription: transcript,
              confidence: data.channel.alternatives[0].confidence,
              timestamp: new Date().toISOString()
            });
            
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                command: 'ALARM',
                transcription: transcript,
                confidence: data.channel.alternatives[0].confidence
              }));
            }
          }
        }
      });
    });
  }
  
  ws.on('message', (data) => {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'device_id') {
          console.log(`[WS] Device: ${msg.deviceId}`);
        }
      } catch (e) {}
    } else {
      if (SPEECH_API === 'deepgram' && deepgramConnection) {
        deepgramConnection.send(data);
      }
    }
  });
  
  ws.on('close', () => {
    console.log(`[WS] Device ${deviceId} disconnected`);
    deviceConnections.delete(deviceId);
    if (deepgramConnection) deepgramConnection.finish();
  });
});

// Replace: app.listen(PORT, ...
// With:
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## How It Works

### 1. ESP32 Side
1. ESP32 connects to WiFi
2. Initializes INMP441 microphone
3. Connects WebSocket to backend `/ws/audio/{deviceId}`
4. Starts audio streaming task:
   - Reads audio from I2S microphone
   - Sends binary PCM data via WebSocket
   - Runs continuously in background

### 2. Backend Side
1. Receives WebSocket connection from device
2. Opens Deepgram live transcription stream
3. Forwards audio data to Deepgram
4. Monitors transcriptions for trigger words
5. Sends ALARM command back to device when triggered

### 3. Alarm Flow
```
Microphone → ESP32 I2S → WebSocket → Backend → Deepgram
              ↓                                    ↓
          Audio Data                        Transcription
              ↓                                    ↓
          Streaming                         Trigger Check
              ↓                                    ↓
        Continuous                          ALARM Command
              ↓                                    ↓
       Real-time ←←←←←←←← WebSocket ←←←←← Backend
              ↓
        Relay ON + LoRa
```

## Usage Instructions

### 1. Configure Device
1. Connect to device AP (VoiceAlarm)
2. Go to http://192.168.4.1/config
3. Set your WiFi credentials
4. Set backend URL (e.g., http://your-server.com:3000)
5. Save settings

### 2. Start Streaming
**Option A - Auto-start (recommended):**
Add to setup() in main.cpp:
```cpp
if (WiFi.isConnected() && backendURL.length() > 0) {
  delay(2000); // Wait for backend
  startMicStreaming();
}
```

**Option B - Manual via web:**
```bash
curl -X POST http://<device-ip>/api/mic/start
```

### 3. Monitor
```bash
# Check mic status
curl http://<device-ip>/api/mic/status

# Backend logs show:
# 🎤 [WS] Device ALM0001 connected
# [ALM0001] Deepgram connected
# [ALM0001] 📝 hello there
# 🚨 [ALM0001] ALARM TRIGGERED: emergency help!
```

## Trigger Words
Default: `alarm`, `emergency`, `help`, `fire`

Configure in backend `.env`:
```
TRIGGER_WORDS=alarm,emergency,help,fire,alert
```

## Troubleshooting

**WebSocket won't connect:**
- Check backend URL in device config
- Ensure backend has WebSocket support (ws npm package)
- Verify firewall allows WebSocket connections

**No transcriptions:**
- Verify DEEPGRAM_API_KEY in backend .env
- Check microphone wiring (SD=34, WS=25, SCK=22)
- Monitor Serial output for I2S errors

**Audio quality issues:**
- Ensure 3.3V power to INMP441
- Check for ground loops
- Try different sample rates (8000, 16000)

**High CPU usage:**
- Reduce BUFFER_LEN (currently 1024)
- Increase task delay
- Use lower sample rate

## Benefits Over HTTP Polling

| Feature | HTTP Polling | WebSocket Live |
|---------|-------------|----------------|
| Latency | 2-3 seconds | < 1 second |
| Bandwidth | High (repeated uploads) | Low (continuous stream) |
| Real-time | No | Yes |
| Transcription | Batch (file-based) | Live (streaming) |
| Responsiveness | Delayed | Immediate |

## Next Steps

1. ✅ Hardware: INMP441 connected
2. ✅ ESP32: WebSocket client ready
3. ⚠️ Backend: Add WebSocket code above
4. 🔄 Test: `POST /api/mic/start` and speak trigger words
5. 🎉 Deploy: Real-time voice-controlled alarm system!
