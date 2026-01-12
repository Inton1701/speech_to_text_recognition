// Quick test script to validate Deepgram API key
const { createClient } = require('@deepgram/sdk');
require('dotenv').config();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

console.log('\n🔍 Testing Deepgram API Key...\n');
console.log('API Key:', DEEPGRAM_API_KEY ? 'Found' : 'NOT FOUND');
console.log('Key length:', DEEPGRAM_API_KEY?.length || 0);
console.log('Key preview:', DEEPGRAM_API_KEY ? DEEPGRAM_API_KEY.substring(0, 15) + '...' : 'N/A');

if (!DEEPGRAM_API_KEY) {
  console.error('\n❌ No API key found in .env file');
  console.log('Create a .env file with: DEEPGRAM_API_KEY=your_key_here');
  process.exit(1);
}

// Test prerecorded API (should work with any key)
async function testPrerecorded() {
  try {
    console.log('\n📝 Testing prerecorded transcription...');
    const deepgram = createClient(DEEPGRAM_API_KEY);
    const { result } = await deepgram.listen.prerecorded.transcribeUrl(
      { url: 'https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav' },
      { model: 'nova-2', smart_format: true }
    );
    
    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    console.log('✅ Prerecorded API works!');
    console.log('   Transcript:', transcript);
    return true;
  } catch (err) {
    console.error('❌ Prerecorded API failed:', err.message);
    return false;
  }
}

// Test live streaming API (requires specific permissions)
async function testLiveStreaming() {
  return new Promise((resolve) => {
    try {
      console.log('\n🎙️ Testing live streaming...');
      const deepgram = createClient(DEEPGRAM_API_KEY);
      const connection = deepgram.listen.live({
        model: 'nova-2',
        language: 'en',
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1
      });
      
      let opened = false;
      
      const timeout = setTimeout(() => {
        if (!opened) {
          console.error('❌ Live streaming connection timeout');
          console.log('   This usually means:');
          console.log('   - API key lacks live streaming permissions');
          console.log('   - Network/firewall blocking WebSocket');
          connection.finish();
          resolve(false);
        }
      }, 10000);
      
      connection.on('Open', () => {
        clearTimeout(timeout);
        opened = true;
        console.log('✅ Live streaming API works!');
        console.log('   Your API key supports live transcription');
        connection.finish();
        resolve(true);
      });
      
      connection.on('error', (err) => {
        clearTimeout(timeout);
        console.error('❌ Live streaming error:', err);
        console.log('   Error type:', err?.type);
        console.log('   Error code:', err?.code);
        resolve(false);
      });
      
      connection.on('close', (event) => {
        if (!opened) {
          console.error('❌ Connection closed before opening');
          console.log('   Close code:', event?.code);
          console.log('   Close reason:', event?.reason || '(none)');
          if (event?.code === 1006) {
            console.log('   💡 Code 1006 = Authentication failed or invalid API key');
          }
        }
      });
      
    } catch (err) {
      console.error('❌ Failed to create live connection:', err.message);
      resolve(false);
    }
  });
}

// Run tests
(async () => {
  const prerecordedWorks = await testPrerecorded();
  
  if (prerecordedWorks) {
    const liveWorks = await testLiveStreaming();
    
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Test Results:');
    console.log('   Prerecorded API: ' + (prerecordedWorks ? '✅ Works' : '❌ Failed'));
    console.log('   Live Streaming:  ' + (liveWorks ? '✅ Works' : '❌ Failed'));
    console.log('═'.repeat(50));
    
    if (!liveWorks) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Check if your Deepgram API key has "Live Transcription" enabled');
      console.log('   2. Go to: https://console.deepgram.com/');
      console.log('   3. Create a new API key with all permissions enabled');
      console.log('   4. Update your .env file with the new key');
    }
  }
  
  process.exit(0);
})();
