# Voice Chat Avatar

A real-time voice chat interface where you speak to an animated 3D avatar powered by Google Gemini AI.

## Features

- 3D avatar with realistic lip-sync animation
- Voice input using your microphone
- AI responses powered by Gemini 2.0 Flash
- Text-to-speech output using browser Web Speech API
- Real-time conversation flow

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6 modules)
- **3D Rendering**: TalkingHead.js (built on Three.js)
- **Avatar**: Ready Player Me 3D model
- **AI**: Google Gemini Live API (WebSocket)
- **TTS**: Browser Web Speech API

## Setup Instructions

### 1. Get a Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy your API key
4. Add it to your `.env` file:

```bash
GEMINI_API_KEY=your_actual_api_key_here
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Application

```bash
npm start
```

The server will start at `http://localhost:3000`

### 4. Use the Application

1. Open `http://localhost:3000` in your browser
2. Click "Start Chat"
3. Allow microphone access when prompted
4. Speak naturally to the avatar
5. Wait for the avatar to respond with voice and lip-sync
6. Click "Stop" to end the conversation

**Note:** The API key is now loaded securely from the `.env` file on the backend, not from the frontend.

## How It Works

### Data Flow

```
User Mic → PCM Audio → Gemini Live API (WebSocket)
    ↓
Gemini AI Response (Text)
    ↓
Web Speech API (TTS) → Audio Playback
    ↓
TalkingHead.js Lip Sync → 3D Avatar Animation
```

### Architecture

1. **Audio Capture**: Browser `getUserMedia()` API captures microphone input
2. **Audio Processing**: Web Audio API converts to 16kHz PCM format
3. **Gemini Integration**: WebSocket sends audio chunks, receives text responses
4. **Text-to-Speech**: Browser Speech Synthesis API converts text to speech
5. **Lip Sync**: TalkingHead.js analyzes audio and animates avatar blend shapes

## File Structure

```
aba_hw/
├── index.html       # Main HTML structure (58 lines)
├── style.css        # UI styling (174 lines)
├── app.js           # Core application logic (303 lines)
├── README.md        # This file
├── avatar.zip       # Original avatar files (optional)
└── .gitignore       # Git ignore rules
```

**Total code: ~535 lines** (HTML + CSS + JS)

## Browser Compatibility

- **Chrome/Edge**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Partial support (Web Speech API has limited voices)
- **Mobile**: Works on iOS Safari and Chrome Android

**Requirements:**
- Modern browser with ES6 module support
- HTTPS or localhost (required for microphone access)
- Stable internet connection (for Gemini API and avatar loading)

## Troubleshooting

### Avatar Not Loading
- Check browser console for errors
- Ensure you have internet connection (avatar loads from Ready Player Me CDN)
- Try refreshing the page

### Microphone Not Working
- Ensure you granted microphone permissions
- Use HTTPS or localhost (HTTP blocks mic access)
- Check browser console for permission errors

### No Voice Output
- Check that your system volume is not muted
- Verify browser supports Web Speech API (Chrome/Edge/Firefox)
- Try a different browser if issues persist

### Gemini API Errors
- Verify your API key is correct
- Check your API quota at [Google AI Studio](https://makersuite.google.com/)
- Ensure you're using a valid model name (`gemini-2.0-flash-exp`)

### CORS Errors
- Make sure you're running via a local server (not `file://` protocol)
- Use one of the methods in Setup Instructions above

## API Key Security

The API key is stored in your browser's `localStorage` and never sent anywhere except Google's official API endpoint. For production apps, you should:

1. Use a backend proxy server
2. Implement rate limiting
3. Set API usage quotas in Google Cloud Console
4. Never commit API keys to Git

## Customization

### Change Avatar

Replace the Ready Player Me URL in `app.js`:

```javascript
const nodeAvatar = await head.showAvatar({
    url: 'https://models.readyplayer.me/YOUR_AVATAR_ID.glb',
    // ... other options
});
```

Get free avatars at [Ready Player Me](https://readyplayer.me/)

### Change Voice

Modify the `utterance` settings in `app.js`:

```javascript
utterance.lang = 'en-US';  // Language
utterance.rate = 1.0;      // Speed (0.1 to 10)
utterance.pitch = 1.0;     // Pitch (0 to 2)
```

### Change AI Model

Edit the model name in `app.js` (line 88):

```javascript
// Options for WebSocket/Live API:
const model = 'gemini-3-pro-preview';      // Latest Gemini 3 (recommended)
// const model = 'gemini-2.0-flash-exp';   // Gemini 2.0 Flash
```

**Note:** `gemini-3-pro-preview` is the latest model with audio support.

## Known Limitations

1. **Web Speech API voices vary by browser/OS** - Chrome has the best selection
2. **No interruption support in MVP** - Avatar must finish speaking before you talk
3. **Lip sync quality depends on audio** - Works best with clear speech
4. **API costs** - Gemini API has free tier, but usage limits apply

## Future Enhancements

- Add conversation history/context
- Support interruptions (user can cut in mid-sentence)
- Add emotion detection and avatar mood changes
- Implement conversation memory across sessions
- Add support for multiple languages
- Custom TTS with better voice quality (e.g., ElevenLabs)
- Deploy to a static hosting service (Netlify/Vercel)

## Credits

- **TalkingHead.js**: [met4citizen](https://github.com/met4citizen/TalkingHead)
- **Three.js**: [mrdoob](https://github.com/mrdoob/three.js)
- **Ready Player Me**: [readyplayer.me](https://readyplayer.me/)
- **Gemini API**: [Google AI](https://ai.google.dev/)

## License

MIT License - Feel free to use for your class project!

Built as a class project demonstrating real-time AI voice chat with 3D avatars.
