# 🚀 Deployment Guide - Render

This guide will help you deploy the Voice Recognition Alarm Backend to Render.

## Prerequisites

- [ ] GitHub account
- [ ] Render account (free tier available at [render.com](https://render.com))
- [ ] Deepgram API key ([get free key](https://deepgram.com))

## Step 1: Prepare Your Repository

1. **Push your code to GitHub:**

```bash
cd backend
git init
git add .
git commit -m "Initial commit - Voice Alarm Backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/voice-alarm-backend.git
git push -u origin main
```

## Step 2: Create Render Web Service

1. **Go to Render Dashboard**: https://dashboard.render.com/

2. **Click "New +"** → **"Web Service"**

3. **Connect Your Repository**:
   - Click "Connect account" if not connected
   - Select your GitHub repository
   - Click "Connect"

4. **Configure the Service**:
   ```
   Name:              voice-alarm-backend
   Region:            Choose nearest to your ESP32
   Branch:            main
   Root Directory:    backend
   Runtime:           Node
   Build Command:     npm install
   Start Command:     npm start
   ```

5. **Select Plan**:
   - **Free tier** is sufficient for testing
   - Upgrade to **Starter** ($7/month) for production use
   - Free tier spins down after inactivity (cold starts ~30s)

## Step 3: Set Environment Variables

In the Render dashboard, scroll to **Environment Variables** section:

### Required Variables:

```
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

### Optional Variables:

```
PORT=3000
TRIGGER_WORDS=alarm,emergency,help,fire
```

**How to add:**
1. Click "Add Environment Variable"
2. Enter key and value
3. Repeat for each variable

## Step 4: Deploy

1. Click **"Create Web Service"**
2. Wait for the build to complete (2-3 minutes)
3. Your backend will be live at: `https://your-app-name.onrender.com`

## Step 5: Test Your Deployment

### Test with curl:

```bash
# Health check
curl https://your-app-name.onrender.com/health

# Should return:
# {"status":"ok","timestamp":"...","triggerWords":["alarm","emergency","help","fire"]}
```

### Test with audio file:

```bash
# Record a WAV file (or use existing)
curl -X POST https://your-app-name.onrender.com/api/process-audio \
  -H "Content-Type: audio/wav" \
  -H "X-Device-ID: TEST001" \
  --data-binary @test-audio.wav
```

## Step 6: Configure ESP32

1. Connect to your ESP32's WiFi AP
2. Open browser to `192.168.4.1`
3. Go to Configuration page
4. Set **Backend Server URL** to:
   ```
   https://your-app-name.onrender.com/api/process-audio
   ```
5. Save and restart ESP32

## ✅ Verification

Your deployment is successful when:

- [ ] `/health` endpoint returns status "ok"
- [ ] Backend logs show in Render dashboard
- [ ] ESP32 can send audio to backend
- [ ] Transcriptions appear in ESP32 web interface
- [ ] Alarm triggers on correct keywords

## 🎯 Production Checklist

For production deployments:

### Security
- [ ] Use **Starter tier** or higher (no cold starts)
- [ ] Add **rate limiting** to prevent abuse
- [ ] Add **authentication** for sensitive endpoints
- [ ] Use **HTTPS only** (Render provides free SSL)
- [ ] Rotate **Deepgram API key** regularly

### Monitoring
- [ ] Enable **Render metrics** (CPU, memory, requests)
- [ ] Set up **log draining** (optional)
- [ ] Configure **health check notifications**
- [ ] Monitor **Deepgram API usage**

### Performance
- [ ] Upgrade to **Starter tier** ($7/month) to avoid cold starts
- [ ] Consider **multiple regions** for global deployment
- [ ] Enable **HTTP/2** (automatic on Render)
- [ ] Monitor **response times**

## 📊 Monitoring Your Backend

### View Logs:
1. Go to your service in Render dashboard
2. Click **"Logs"** tab
3. Watch real-time logs

### Check Metrics:
1. Click **"Metrics"** tab
2. View CPU, memory, and request graphs

### Set Up Alerts:
1. Go to **Settings** → **Notifications**
2. Add email for deployment failures
3. Add webhook for custom alerts

## 🔄 Updates and Redeployment

### Automatic Deployment:
Render automatically redeploys when you push to GitHub:

```bash
cd backend
# Make your changes
git add .
git commit -m "Update trigger words"
git push origin main
```

### Manual Deployment:
1. Go to your service dashboard
2. Click **"Manual Deploy"** → **"Deploy latest commit"**

## 💰 Cost Estimation

### Free Tier:
- ✅ Good for testing
- ✅ 750 hours/month free
- ⚠️ Spins down after 15 min inactivity
- ⚠️ Cold start: ~30 seconds

### Starter Tier ($7/month):
- ✅ Always on (no cold starts)
- ✅ Better for production
- ✅ More resources
- ✅ Priority support

### Deepgram Costs:
- Free tier: 45,000 minutes/month
- Pay-as-you-go: $0.0043/minute
- Average alarm check: ~5 seconds = $0.00036

**Example monthly cost:**
- 1000 voice commands/month
- 5 seconds each = 5000 seconds = 83 minutes
- Cost: ~$0.36/month (within free tier)

## 🐛 Troubleshooting

### "Service Unavailable" error:
- Check Render service status
- Wait 30 seconds if on free tier (cold start)
- Check environment variables are set

### "Invalid API key" error:
- Verify `DEEPGRAM_API_KEY` in Render env vars
- Check key is active in Deepgram dashboard
- Try regenerating key

### High response times:
- Upgrade to Starter tier (no cold starts)
- Check Render region matches ESP32 location
- Monitor Deepgram API response times

### Build failures:
- Check `package.json` is valid
- Verify Node version compatibility
- Check Render build logs for errors

## 🔗 Useful Links

- [Render Dashboard](https://dashboard.render.com/)
- [Render Documentation](https://render.com/docs)
- [Deepgram Console](https://console.deepgram.com/)
- [Node.js on Render](https://render.com/docs/deploy-node-express-app)

## 🆘 Support

- Render Support: [support@render.com](mailto:support@render.com)
- Render Community: [community.render.com](https://community.render.com/)
- Deepgram Support: [support@deepgram.com](mailto:support@deepgram.com)

---

**Happy Deploying! 🚀**
