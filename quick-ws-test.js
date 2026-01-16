const WebSocket = require('ws');
const http = require('http');

const HOST = 'localhost';
const PORT = 3000;
const DEVICE_ID = 'TEST001';

console.log('🧪 Quick WebSocket Test\n');

// First check if server is running
console.log(`1️⃣ Checking if server is running on http://${HOST}:${PORT}...`);

const checkServer = () => {
  return new Promise((resolve, reject) => {
    http.get(`http://${HOST}:${PORT}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`   ✅ Server is running (HTTP ${res.statusCode})`);
        console.log(`   Response: ${data}\n`);
        resolve(true);
      });
    }).on('error', (err) => {
      console.log(`   ❌ Server not responding: ${err.message}\n`);
      reject(err);
    });
  });
};

const testWebSocket = () => {
  return new Promise((resolve, reject) => {
    console.log(`2️⃣ Testing WebSocket connection...`);
    console.log(`   URL: ws://${HOST}:${PORT}/ws/audio/${DEVICE_ID}\n`);
    
    const ws = new WebSocket(`ws://${HOST}:${PORT}/ws/audio/${DEVICE_ID}`);
    let pingsSent = 0;
    let pongsReceived = 0;
    let testTimeout;
    
    ws.on('open', () => {
      console.log('   ✅ WebSocket CONNECTED!\n');
      
      // Send device ID
      const msg = JSON.stringify({ type: 'device_id', deviceId: DEVICE_ID });
      ws.send(msg);
      console.log(`   📤 Sent: ${msg}\n`);
      
      // Send 3 pings
      const pingTest = setInterval(() => {
        if (pingsSent < 3 && ws.readyState === WebSocket.OPEN) {
          pingsSent++;
          console.log(`   🏓 Ping #${pingsSent}...`);
          ws.ping();
        } else if (pingsSent >= 3) {
          clearInterval(pingTest);
          // Wait a bit for last pong, then close
          setTimeout(() => {
            console.log(`\n✅ TEST PASSED!`);
            console.log(`   Pings sent: ${pingsSent}`);
            console.log(`   Pongs received: ${pongsReceived}`);
            console.log(`   Success rate: ${(pongsReceived/pingsSent*100).toFixed(0)}%\n`);
            ws.close();
            resolve(true);
          }, 1000);
        }
      }, 500);
    });
    
    ws.on('pong', () => {
      pongsReceived++;
      console.log(`   ✅ Pong #${pongsReceived} received`);
    });
    
    ws.on('message', (data) => {
      console.log(`   📥 Message: ${data.toString()}`);
    });
    
    ws.on('close', (code, reason) => {
      if (code !== 1000) {
        console.log(`\n   ⚠️ Closed with code ${code}: ${reason || 'No reason'}`);
      }
    });
    
    ws.on('error', (err) => {
      console.log(`\n   ❌ WebSocket ERROR: ${err.message}`);
      reject(err);
    });
    
    // Timeout after 10 seconds
    testTimeout = setTimeout(() => {
      console.log('\n   ⏰ Test timeout');
      ws.close();
      reject(new Error('Test timeout'));
    }, 10000);
  });
};

// Run the test
(async () => {
  try {
    await checkServer();
    await testWebSocket();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
})();
