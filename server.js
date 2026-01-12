const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { AssemblyAI } = require('assemblyai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const SPEECH_API = process.env.SPEECH_API || 'deepgram'; // 'deepgram' or 'assemblyai'
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

// Initialize AssemblyAI client
const assemblyai = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY
});

console.log(`🎤 Speech API: ${SPEECH_API.toUpperCase()}`);
console.log(`🔑 API Key configured: ${SPEECH_API === 'assemblyai' ? '✓ AssemblyAI' : '✓ Deepgram'}`);

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
