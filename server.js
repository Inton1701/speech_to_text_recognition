const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { AssemblyAI } = require('assemblyai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const SPEECH_API = process.env.SPEECH_API || 'deepgram'; // 'deepgram' or 'assemblyai'
const TRIGGER_WORDS = (process.env.TRIGGER_WORDS || 'alarm,emergency,help,fire').toLowerCase().split(',');
const DEVICE_KEY = process.env.DEVICE_KEY || 'esp32-internal-key-change-in-production';

// Store device results (in production, use Redis or database)
const deviceResults = new Map();

// Middleware: Device authentication for internal endpoints
function authenticateDevice(req, res, next) {
  const deviceKey = req.headers['x-device-key'];
  
  if (!deviceKey || deviceKey !== DEVICE_KEY) {
    console.warn('⚠️ Unauthorized device access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.raw({
  type: 'audio/wav',
  limit: '10mb'
}));
app.use(express.raw({
  type: 'audio/webm',
  limit: '10mb'
}));
app.use(express.raw({
  type: 'audio/raw',
  limit: '10mb'
}));
app.use(express.static('public'));

// Set up EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Deepgram client
const deepgram = createClient(DEEPGRAM_API_KEY);

// Initialize AssemblyAI client
const assemblyai = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY
});

console.log(`🎤 Speech API: ${SPEECH_API.toUpperCase()}`);
console.log(`🔑 API Key configured: ${SPEECH_API === 'assemblyai' ? '✓ AssemblyAI' : '✓ Deepgram'}`);

// WebSocket connections for live audio streaming
const deviceConnections = new Map();
const SAMPLE_RATE = 16000;
const BUFFER_DURATION = 3; // seconds (for AssemblyAI buffering)

wss.on('connection', (ws, req) => {
  const urlPath = req.url;
  const deviceIdMatch = urlPath.match(/\/ws\/audio\/([^/]+)/);
  const deviceId = deviceIdMatch ? deviceIdMatch[1] : 'unknown';
  
  console.log(`\n🎤 [WS] Device ${deviceId} connected via WebSocket`);
  console.log(`[${deviceId}] Using ${SPEECH_API.toUpperCase()} for transcription`);
  
  let audioBuffer = [];
  let deepgramConnection = null;
  let processingInterval = null;
  
  deviceConnections.set(deviceId, ws);
  
  // Initialize Deepgram live transcription
  if (SPEECH_API === 'deepgram') {
    console.log(`[${deviceId}] Starting Deepgram live transcription...`);
    
    deepgramConnection = deepgram.listen.live({
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      interim_results: false,
      utterance_end_ms: 1000,
      endpointing: 300
    });
    
    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[${deviceId}] ✓ Deepgram connection opened`);
      
      deepgramConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        const confidence = data.channel.alternatives[0].confidence;
        
        if (transcript && transcript.trim().length > 0) {
          console.log(`[${deviceId}] 📝 "${transcript}" (${(confidence * 100).toFixed(1)}%)`);
          
          const triggered = checkTriggerWords(transcript);
          
          if (triggered) {
            console.log(`\n🚨 [${deviceId}] ALARM TRIGGERED: "${transcript}"\n`);
            
            deviceResults.set(deviceId, {
              triggered: true,
              transcription: transcript,
              confidence: confidence,
              timestamp: new Date().toISOString()
            });
            
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                command: 'ALARM',
                transcription: transcript,
                confidence: confidence
              }));
            }
          } else {
            // Send transcription update
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'transcription',
                transcription: transcript,
                confidence: confidence
              }));
            }
          }
        }
      });
      
      deepgramConnection.on(LiveTranscriptionEvents.Error, (error) => {
        console.error(`[${deviceId}] Deepgram error:`, error);
      });
      
      deepgramConnection.on(LiveTranscriptionEvents.Close, () => {
        console.log(`[${deviceId}] Deepgram connection closed`);
      });
    });
  }
  
  // Initialize AssemblyAI buffered transcription
  if (SPEECH_API === 'assemblyai') {
    console.log(`[${deviceId}] Starting AssemblyAI buffered transcription (${BUFFER_DURATION}s chunks)...`);
    
    // Process audio buffer periodically
    processingInterval = setInterval(async () => {
      if (audioBuffer.length > 0) {
        const bufferCopy = [...audioBuffer];
        audioBuffer = [];
        await processAssemblyAIBuffer(deviceId, bufferCopy, ws);
      }
    }, BUFFER_DURATION * 1000);
  }
  
  ws.on('message', (data) => {
    if (typeof data === 'string') {
      // Text message (device info, commands)
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'device_id') {
          console.log(`[WS] Device identified: ${msg.deviceId}`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    } else {
      // Binary audio data
      if (SPEECH_API === 'deepgram' && deepgramConnection) {
        // Stream directly to Deepgram
        deepgramConnection.send(data);
      } else if (SPEECH_API === 'assemblyai') {
        // Buffer for AssemblyAI
        audioBuffer.push(Buffer.from(data));
      }
    }
  });
  
  ws.on('close', () => {
    console.log(`[WS] Device ${deviceId} disconnected`);
    deviceConnections.delete(deviceId);
    
    if (deepgramConnection) {
      deepgramConnection.finish();
    }
    
    if (processingInterval) {
      clearInterval(processingInterval);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`[${deviceId}] WebSocket error:`, error);
  });
});

// Check if transcript contains trigger words
function checkTriggerWords(transcript) {
  const lowerTranscript = transcript.toLowerCase();
  return TRIGGER_WORDS.some(word => {
    const similarity = calculateSimilarity(lowerTranscript, word);
    return lowerTranscript.includes(word) || similarity > 0.8;
  });
}

// Process buffered audio for AssemblyAI
async function processAssemblyAIBuffer(deviceId, audioBuffer, ws) {
  if (audioBuffer.length === 0) return;
  
  try {
    const audioData = Buffer.concat(audioBuffer);
    console.log(`[${deviceId}] Processing ${audioData.length} bytes with AssemblyAI...`);
    
    // Create WAV buffer
    const wavBuffer = createWavBuffer(audioData);
    
    // Transcribe with AssemblyAI
    const transcript = await assemblyai.transcripts.transcribe({
      audio: wavBuffer,
      language_code: 'en'
    });
    
    if (transcript.text && transcript.text.trim().length > 0) {
      const confidence = transcript.confidence || 0;
      console.log(`[${deviceId}] 📝 "${transcript.text}" (${(confidence * 100).toFixed(1)}%)`);
      
      const triggered = checkTriggerWords(transcript.text);
      
      if (triggered) {
        console.log(`\n🚨 [${deviceId}] ALARM TRIGGERED: "${transcript.text}"\n`);
        
        deviceResults.set(deviceId, {
          triggered: true,
          transcription: transcript.text,
          confidence: confidence,
          timestamp: new Date().toISOString()
        });
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            command: 'ALARM',
            transcription: transcript.text,
            confidence: confidence
          }));
        }
      } else {
        // Send transcription update
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transcription',
            transcription: transcript.text,
            confidence: confidence
          }));
        }
      }
    }
  } catch (error) {
    console.error(`[${deviceId}] Error processing audio with AssemblyAI:`, error.message);
  }
}

// Create WAV buffer from PCM data
function createWavBuffer(pcmData) {
  const sampleRate = SAMPLE_RATE;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmData.length;
  const fileSize = 44 + dataSize;
  
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  
  return Buffer.concat([header, pcmData]);
}

// Helper function: Calculate similarity between two strings using Dice coefficient
function calculateSimilarity(str1, str2) {
  const bigrams1 = getBigrams(str1);
  const bigrams2 = getBigrams(str2);
  
  const intersection = bigrams1.filter(bigram => bigrams2.includes(bigram));
  const similarity = (2.0 * intersection.length) / (bigrams1.length + bigrams2.length);
  
  return similarity;
}

// Helper function: Get bigrams from a string
function getBigrams(str) {
  const bigrams = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.substring(i, i + 2));
  }
  return bigrams;
}

// Home page - Device control interface
app.get('/', (req, res) => {
  res.render('index', { 
    triggerWords: TRIGGER_WORDS.join(', ')
  });
});

// Device page - Audio recording for specific device
app.get('/device/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  res.render('device', { 
    deviceId,
    triggerWords: TRIGGER_WORDS.join(', ')
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    triggerWords: TRIGGER_WORDS,
    speechAPI: SPEECH_API
  });
});

// Transcribe with AssemblyAI
async function transcribeWithAssemblyAI(audioBuffer, contentType) {
  console.log('🎤 Using AssemblyAI for transcription...');
  
  try {
    // Upload audio file first
    console.log('📤 Uploading audio to AssemblyAI...');
    const uploadResponse = await axios.post('https://api.assemblyai.com/v2/upload', audioBuffer, {
      headers: {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': contentType || 'application/octet-stream'
      }
    });
    
    const uploadUrl = uploadResponse.data.upload_url;
    console.log('✓ Audio uploaded:', uploadUrl);
    
    // Request transcription
    console.log('🔄 Requesting transcription...');
    const transcriptResponse = await axios.post('https://api.assemblyai.com/v2/transcript', {
      audio_url: uploadUrl,
      language_code: 'en'
    }, {
      headers: {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': 'application/json'
      }
    });
    
    const transcriptId = transcriptResponse.data.id;
    console.log('✓ Transcription job created:', transcriptId);
    
    // Poll for completion
    let transcript;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds timeout
    
    while (attempts < maxAttempts) {
      const pollingResponse = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          'authorization': ASSEMBLYAI_API_KEY
        }
      });
      
      transcript = pollingResponse.data;
      
      if (transcript.status === 'completed') {
        console.log('✓ Transcription completed');
        return {
          transcript: transcript.text || '',
          confidence: transcript.confidence || 0
        };
      } else if (transcript.status === 'error') {
        console.error('❌ AssemblyAI transcription error:', transcript.error);
        throw new Error(transcript.error || 'Transcription failed');
      }
      
      // Wait 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('Transcription timeout');
    
  } catch (error) {
    console.error('❌ AssemblyAI error:', error.message);
    throw error;
  }
}

// Transcribe with Deepgram
async function transcribeWithDeepgram(audioBuffer, contentType) {
  console.log('🎤 Using Deepgram for transcription...');
  
  let deepgramOptions = {
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    punctuate: true,
    diarize: false
  };
  
  // Configure based on audio format
  if (contentType.includes('audio/webm') || contentType.includes('webm')) {
    console.log('🔧 Configuring for WebM/Opus format');
  } else if (contentType.includes('audio/wav') || contentType.includes('wav')) {
    console.log('🔧 Configuring for WAV format');
  } else if (contentType.includes('audio/raw')) {
    console.log('🔧 Configuring for raw PCM format');
    deepgramOptions.encoding = 'linear16';
    deepgramOptions.sample_rate = 16000;
    deepgramOptions.channels = 1;
  } else {
    console.log('🔧 Unknown format, letting Deepgram auto-detect');
  }
  
  console.log('Options:', JSON.stringify(deepgramOptions));
  
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    deepgramOptions
  );
  
  if (error) {
    console.error('❌ Deepgram error:', error);
    throw new Error('Transcription failed: ' + error.message);
  }
  
  const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  const confidence = result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
  
  return { transcript, confidence };
}

// Process audio from ESP32 and return transcription with trigger status
app.post('/api/process-audio', async (req, res) => {
  const startTime = Date.now();
  console.log('\n=== New Audio Request ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  console.log('Device ID:', req.headers['x-device-id'] || 'unknown');
  
  // Check if API is specified in request header, otherwise use .env default
  const requestedAPI = req.headers['x-speech-api'] || SPEECH_API;
  console.log('Speech API:', requestedAPI.toUpperCase());
  
  try {
    const audioData = req.body;
    
    if (!audioData || audioData.length === 0) {
      console.error('❌ No audio data received');
      return res.status(400).json({ 
        success: false, 
        error: 'No audio data provided' 
      });
    }
    
    console.log('📊 Audio data size:', audioData.length, 'bytes');
    
    // Determine audio format from content-type
    const contentType = req.headers['content-type'] || 'audio/webm';
    console.log('🎵 Audio format:', contentType);
    
    // Transcribe using selected API
    let transcript, confidence;
    
    try {
      if (requestedAPI === 'assemblyai') {
        const result = await transcribeWithAssemblyAI(audioData, contentType);
        transcript = result.transcript;
        confidence = result.confidence;
      } else {
        const result = await transcribeWithDeepgram(audioData, contentType);
        transcript = result.transcript;
        confidence = result.confidence;
      }
    } catch (error) {
      console.error('❌ Transcription error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Transcription failed',
        details: error.message 
      });
    }
    
    console.log('📝 Transcription:', transcript);
    console.log('📊 Confidence:', confidence);
    
    // Enhanced trigger word detection with fuzzy matching
    const transcriptLower = transcript.toLowerCase();
    const transcriptWords = transcriptLower.split(/\s+/); // Split into individual words
    
    const triggeredWords = [];
    
    for (const triggerWord of TRIGGER_WORDS) {
      const trimmedTrigger = triggerWord.trim().toLowerCase();
      
      // Method 1: Exact match (current behavior)
      if (transcriptLower.includes(trimmedTrigger)) {
        triggeredWords.push(trimmedTrigger);
        continue;
      }
      
      // Method 2: Check if any word in transcript contains the trigger word (partial match)
      for (const word of transcriptWords) {
        if (word.includes(trimmedTrigger) || trimmedTrigger.includes(word)) {
          if (word.length >= 2 && trimmedTrigger.length >= 2) { // Avoid single letter matches
            triggeredWords.push(trimmedTrigger + ' (matched: ' + word + ')');
            break;
          }
        }
      }
      
      // Method 3: Fuzzy match - check similarity
      for (const word of transcriptWords) {
        if (word.length >= 3 && trimmedTrigger.length >= 3) {
          const similarity = calculateSimilarity(word, trimmedTrigger);
          if (similarity >= 0.7) { // 70% similarity threshold
            triggeredWords.push(trimmedTrigger + ' (fuzzy: ' + word + ', ' + (similarity * 100).toFixed(0) + '%)');
            break;
          }
        }
      }
    }
    
    const shouldTrigger = triggeredWords.length > 0;
    
    if (shouldTrigger) {
      console.log('🚨 TRIGGER DETECTED! Words:', triggeredWords.join(', '));
    } else {
      console.log('✅ No trigger words detected');
    }
    
    const processingTime = Date.now() - startTime;
    console.log('⏱️  Processing time:', processingTime, 'ms');
    
    // Store result for device if device ID provided
    const deviceId = req.headers['x-device-id'];
    if (deviceId && shouldTrigger) {
      deviceResults.set(deviceId, {
        transcription: transcript,
        confidence: confidence,
        triggered: true,
        triggeredWords: triggeredWords,
        timestamp: new Date().toISOString()
      });
      console.log('📝 Stored trigger result for device:', deviceId);
    }
    
    // Send response
    const responseData = {
      success: true,
      transcription: transcript,
      confidence: confidence,
      triggered: shouldTrigger,
      triggeredWords: triggeredWords,
      processingTime: processingTime,
      speechAPI: requestedAPI,
      timestamp: new Date().toISOString()
    };
    
    console.log('📤 Sending response:', JSON.stringify(responseData));
    
    res.json(responseData);
    
  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// WebSocket endpoint for real-time streaming (optional, for future use)
app.get('/api/stream', (req, res) => {
  res.status(501).json({ 
    error: 'WebSocket streaming not yet implemented. Use /api/process-audio for now.' 
  });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    triggerWords: TRIGGER_WORDS,
    model: 'nova-2',
    language: 'en'
  });
});

// ESP32 polling endpoint - Check for trigger results
app.get('/api/device/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const result = deviceResults.get(deviceId);
  
  if (result) {
    // Clear result after sending (consume once)
    deviceResults.delete(deviceId);
    console.log('✓ Sent trigger result to device:', deviceId);
    res.json({
      triggered: true,
      ...result
    });
  } else {
    res.json({
      triggered: false,
      message: 'No pending triggers'
    });
  }
});

// Clear device result manually
app.post('/api/device/:deviceId/clear', (req, res) => {
  const { deviceId } = req.params;
  deviceResults.delete(deviceId);
  res.json({ success: true });
});

// ========================================
// INTERNAL ENDPOINTS (HTTP-only for ESP32)
// ========================================

// Internal: Device heartbeat (HTTP-only, no HTTPS required)
app.post('/internal/device/:deviceId/heartbeat', authenticateDevice, (req, res) => {
  const { deviceId } = req.params;
  const { alive, ip, rssi } = req.body;
  
  console.log(`💓 [Internal] Heartbeat from ${deviceId} (RSSI: ${rssi}dBm)`);
  
  // Check for pending triggers
  const result = deviceResults.get(deviceId);
  
  if (result) {
    deviceResults.delete(deviceId);
    console.log(`🚨 [Internal] Sending ALARM to ${deviceId}`);
    return res.json({
      triggered: true,
      command: 'ALARM',
      ...result
    });
  }
  
  res.json({
    triggered: false,
    message: 'ok'
  });
});

// Internal: Device status check (HTTP-only)
app.get('/internal/device/:deviceId/status', authenticateDevice, (req, res) => {
  const { deviceId } = req.params;
  const result = deviceResults.get(deviceId);
  
  if (result) {
    deviceResults.delete(deviceId);
    console.log(`✓ [Internal] Sent trigger result to ${deviceId}`);
    res.json({
      triggered: true,
      ...result
    });
  } else {
    res.json({
      triggered: false,
      message: 'No pending triggers'
    });
  }
});

// ========================================
// PUBLIC ENDPOINTS (HTTPS recommended)
// ========================================

// Update trigger words (optional)
app.post('/api/config/trigger-words', (req, res) => {
  const { words } = req.body;
  
  if (!words || !Array.isArray(words)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid words array' 
    });
  }
  
  // Note: This only updates in memory, not persisted
  TRIGGER_WORDS.length = 0;
  TRIGGER_WORDS.push(...words.map(w => w.toLowerCase().trim()));
  
  console.log('📝 Trigger words updated:', TRIGGER_WORDS);
  
  res.json({
    success: true,
    triggerWords: TRIGGER_WORDS
  });
});

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  
  // Check if this is a WebSocket audio endpoint
  if (pathname.startsWith('/ws/audio/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Reject other WebSocket connections
    socket.destroy();
  }
});

// Start server (use server.listen, not app.listen)
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Voice Recognition Alarm Backend Server         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 Server running on port:', PORT);
  
  // Display active speech API configuration
  if (SPEECH_API === 'deepgram') {
    console.log('🎤 Speech API: Deepgram');
    console.log('   ⚡ Mode: Live streaming (real-time)');
    console.log('   ⏱️  Latency: <1 second');
    console.log('   🔑 API Key:', DEEPGRAM_API_KEY ? '✓ Configured' : '✗ Missing');
  } else if (SPEECH_API === 'assemblyai') {
    console.log('🎤 Speech API: AssemblyAI');
    console.log('   📦 Mode: Buffered processing (3-second chunks)');
    console.log('   ⏱️  Latency: 2-5 seconds');
    console.log('   🔑 API Key:', ASSEMBLYAI_API_KEY ? '✓ Configured' : '✗ Missing');
  }
  
  console.log('🎯 Trigger words:', TRIGGER_WORDS.join(', '));
  console.log('');
  console.log('📍 HTTP Endpoints:');
  console.log('   GET  /health              - Health check');
  console.log('   POST /api/process-audio   - Process audio and get transcription');
  console.log('   GET  /api/config          - Get configuration');
  console.log('   POST /api/config/trigger-words - Update trigger words');
  console.log('');
  console.log('🔌 WebSocket Endpoints:');
  console.log('   WS   /ws/audio/:deviceId  - Live audio streaming from ESP32 devices');
  console.log('');
  console.log('🌐 Ready to accept requests!');
  console.log('═══════════════════════════════════════════════════\n');
});

// Server error handling
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    console.error(`❌ Port ${PORT} requires elevated privileges`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} signal received: closing server gracefully...`);
  
  // Close all WebSocket connections
  console.log('Closing WebSocket connections...');
  deviceConnections.forEach((ws, deviceId) => {
    console.log(`  Closing connection for device: ${deviceId}`);
    ws.close(1001, 'Server shutting down');
  });
  deviceConnections.clear();
  
  // Close WebSocket server
  wss.close(() => {
    console.log('WebSocket server closed');
  });
  
  // Close HTTP server
  server.close(() => {
    console.log('HTTP server closed');
    console.log('✓ Graceful shutdown complete');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('UNHANDLED_REJECTION');
});
