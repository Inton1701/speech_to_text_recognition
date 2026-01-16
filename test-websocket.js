const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3000/ws/audio/TEST001';

console.log('🧪 WebSocket Ping/Pong Test');
console.log(`📡 Connecting to: ${WS_URL}\n`);

const ws = new WebSocket(WS_URL);

let pingCount = 0;
let pongCount = 0;
let pingInterval;

ws.on('open', () => {
  console.log('✅ WebSocket connected successfully!\n');
  
  // Send device identification
  const deviceMsg = JSON.stringify({
    type: 'device_id',
    deviceId: 'TEST001'
  });
  ws.send(deviceMsg);
  console.log('📤 Sent device ID:', deviceMsg);
  
  // Start sending pings every 2 seconds
  pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      pingCount++;
      console.log(`\n🏓 Sending ping #${pingCount}...`);
      ws.ping();
    }
  }, 2000);
});

ws.on('pong', () => {
  pongCount++;
  console.log(`✅ Received pong #${pongCount}`);
  console.log(`   RTT: WebSocket is alive`);
});

ws.on('message', (data) => {
  console.log('\n📥 Received message:');
  try {
    const parsed = JSON.parse(data.toString());
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log(data.toString());
  }
});

ws.on('close', (code, reason) => {
  console.log(`\n❌ WebSocket closed`);
  console.log(`   Code: ${code}`);
  console.log(`   Reason: ${reason || 'No reason provided'}`);
  clearInterval(pingInterval);
  
  console.log(`\n📊 Statistics:`);
  console.log(`   Pings sent: ${pingCount}`);
  console.log(`   Pongs received: ${pongCount}`);
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('\n❌ WebSocket error:', error.message);
  clearInterval(pingInterval);
  process.exit(1);
});

// Test for 15 seconds then close
setTimeout(() => {
  console.log('\n\n⏰ Test duration completed (15 seconds)');
  console.log('📊 Final Statistics:');
  console.log(`   Pings sent: ${pingCount}`);
  console.log(`   Pongs received: ${pongCount}`);
  console.log(`   Success rate: ${pongCount}/${pingCount} (${pingCount > 0 ? (pongCount/pingCount*100).toFixed(1) : 0}%)`);
  
  ws.close();
}, 15000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Test interrupted by user');
  console.log('📊 Statistics:');
  console.log(`   Pings sent: ${pingCount}`);
  console.log(`   Pongs received: ${pongCount}`);
  ws.close();
  process.exit(0);
});
