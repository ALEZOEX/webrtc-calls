#WebRTC Video Conferencing System

A modern, feature-rich video conferencing application built with WebRTC, Node.js, Express, Socket.IO, and PeerJS.

## 🌟 Features

-**Video Conferencing**: High-quality real-time video calls with multiple participants
- **Screen Sharing**: Share your screenwith other participants
- **Interactive Whiteboard**: Collaborate visually with the shared whiteboard
- **Real-time Chat**: Instant messaging with emoji support
- **Responsive Design**: Works on desktop and mobiledevices
- **User Management**: Unique usernames and participant tracking
- **Easy Room Creation**: Generate unique room IDs orjoin existing rooms

## 🛠️ Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), WebRTC
- **Backend**: Node.js, Express.js- **Real-time Communication**: Socket.IO, PeerJS
- **Templating**: EJS (Embedded JavaScript)
- **UI Framework**: Custom CSS with modern design principles

## 📁 Project Structure

```
.
├── public/                 # Static assets
│   ├── script.js           # Main client-sideapplication logic
│   ├── style.css           # Application styling
│   └── whiteboard.js       #Interactive whiteboard functionality
├── views/                  # EJS templates
│   ├── index.ejs           # Main landing page
│   └── room.ejs            # Conference room page
├── server.js              # Main server application
├── package.json           # Node.js dependencies and scripts
├──.env                   # Environment configuration
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose configuration
└── README.md              # This file
```

##🚀 GettingStarted

### Prerequisites

- Node.js (v14 or higher)
- npm (v6or higher)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd webrtc-video-conferencing
```

2. Install dependencies:
```bash
npm install```

###EnvironmentConfiguration

Create a `.env` file in the root directory with the following variables:

```
#Длялокальной разработки
PORT=3030
NODE_ENV=development
CORS_ORIGIN=*

# PeerJS для локальной разработки
PEER_HOST=localhost
PEER_PORT=3030
PEER_PATH=/peerjs
PEER_SECURE=false

PING_TIMEOUT=60000
PING_INTERVAL=25000
MAX_ROOM_HISTORY=100
```

### Startthe Application

```
npmstart```

5. Open your browser and navigate to`http://localhost:3030`

##☁️ Deployment

### Render.com Deployment

1. Fork this repository to your GitHub account
2. Create a new Web Service on Render.com
3. Connect your GitHub repository
4. Configure theservice with these settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
  - Environment Variables:
     - `NODE_ENV`: `production`
     - `PORT`: `3030`
5. Add your custom domain if needed
6. Deploy the service

The application is configured to automatically detect when it's running in a production environmentand adjust the PeerJS configuration accordingly.

### Environment Configurationfor Render.com

When deploying to Render.com, make sure to set the following environment variables in your Render dashboard:

```
NODE_ENV = production
PORT = 3030
```

##🐳Docker Support

Theapplication includes Docker configuration for easy deployment:

```bash
# Using Docker Compose (recommended)
docker-compose up -d

# Using Docker directly
docker build -t webrtc-conference .
docker run -p 3030:3030 webrtc-conference
```

##🔧 Troubleshooting

### Common Issues and Solutions

1. **Participants not appearing in the video grid**
   - This is typically caused by one of these issues:
     - Incoming calls are missed because the call handler is registered too late (after getUserMedia)
     - Mobile browsers (especially iOS) block autoplay of remote video withaudio
     - Network restrictions (CGNAT/mobile networks) requiring TURN servers

2. **Fixes implemented**
   - Incoming calls are now registered immediately after PeerJS initialization
   - Added support for muted autoplay on mobile devices with "Tap to unmute" overlay
   - Implemented TURN servers (OpenRelay) for network traversal
   - Added ICE connection state debugging for troubleshooting

3. **Forcing TURN for testing**
   To test if network issues are causing connection problems:
   - Uncomment the `iceTransportPolicy: 'relay'` line in the PEER_CONFIG in `views/room.ejs`
   - Thisforces all connections through TURN servers
   - If this works, the issue is with NAT traversal

4. **ICE Connection State Debugging**
   The application now logs ICE connection states to the browser console:
   - Look for "ICE [peerId] [state]" and "PC [peerId] [state]"messages
   - States like "connected" or "completed" indicate successful connections
   - States like "failed" or "disconnected" indicate network issues

##🔧Usage1. **Create a Room**: Click "Create Room" on the main page to generate a new conference room with a unique ID
2. **Join a Room**: Click "Join Room" and enter your username and room ID
3. **Video Controls**:
   - Toggle camera on/off
- Mute/unmute microphone
   - Share screen with other participants
   - Open/close interactive whiteboard
4. **Chat**: Send messages and emojis to all participants in real-time
5. **Invite Others**: Share the room link with others to invite them

## 🎨 UI Features

- Moderndark theme interface- Responsive design for all screen sizes
- Intuitive control panel
- Real-time participant indicators
- Animated transitions and feedback
- Customizable whiteboard with drawing tools

## 🔒 Security

- CORS configuration for secure cross-origin requests
- Secure WebSocket connections
- Peer-to-peer communication for videostreams
- Environment-based configuration management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Thanks to the WebRTC, Socket.IO, and PeerJS communities for their excellent documentation and examples- Inspiredbymodern video conferencing platforms like Zoom and Google Meet