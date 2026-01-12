const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const TRIGGER_WORDS = (process.env.TRIGGER_WORDS || 'alarm,emergency,help,fire').toLowerCase().split(',');

// Store device results (in production, use Redis or database)
const deviceResults = new Map();

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
    triggerWords: TRIGGER_WORDS 
  });
});

// Process audio from ESP32 and return transcription with trigger status
app.post('/api/process-audio', async (req, res) => {
  const startTime = Date.now();
  console.log('\n=== New Audio Request ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  console.log('Device ID:', req.headers['x-device-id'] || 'unknown');
  
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
    
    let deepgramOptions = {
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      punctuate: true,
      diarize: false
    };
    
    // Configure based on audio format
    if (contentType.includes('audio/webm') || contentType.includes('webm')) {
      // WebM with Opus codec (most common from browsers)
      console.log('🔧 Configuring for WebM/Opus format');
      // Deepgram auto-detects WebM, but we can be explicit
    } else if (contentType.includes('audio/wav') || contentType.includes('wav')) {
      console.log('🔧 Configuring for WAV format (auto-detect)');
      // Deepgram auto-detects WAV
    } else if (contentType.includes('audio/raw')) {
      // Raw PCM data
      console.log('🔧 Configuring for raw PCM format');
      deepgramOptions.encoding = 'linear16';
      deepgramOptions.sample_rate = 16000;
      deepgramOptions.channels = 1;
    } else {
      console.log('🔧 Unknown format, letting Deepgram auto-detect');
    }
    
    console.log('🎤 Sending to Deepgram...');
    console.log('Options:', JSON.stringify(deepgramOptions));
    
    // Send to Deepgram for transcription
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioData,
      deepgramOptions
    );
    
    if (error) {
      console.error('❌ Deepgram error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Transcription failed',
        details: error.message 
      });
    }
    
    // Debug: Log full Deepgram response
    console.log('🔍 Full Deepgram response:', JSON.stringify(result, null, 2));
    
    // Extract transcription
    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
    
    console.log('📝 Transcription:', transcript);
    console.log('📊 Confidence:', confidence);
    
    // Check for trigger words
    const transcriptLower = transcript.toLowerCase();
    const triggeredWords = TRIGGER_WORDS.filter(word => 
      transcriptLower.includes(word.trim())
    );
    
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Voice Recognition Alarm Backend Server         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 Server running on port:', PORT);
  console.log('🔑 Deepgram API Key:', DEEPGRAM_API_KEY ? '✓ Configured' : '✗ Missing');
  console.log('🎯 Trigger words:', TRIGGER_WORDS.join(', '));
  console.log('');
  console.log('📍 Endpoints:');
  console.log('   GET  /health              - Health check');
  console.log('   POST /api/process-audio   - Process audio and get transcription');
  console.log('   GET  /api/config          - Get configuration');
  console.log('   POST /api/config/trigger-words - Update trigger words');
  console.log('');
  console.log('🌐 Ready to accept requests!');
  console.log('═══════════════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  process.exit(0);
});
