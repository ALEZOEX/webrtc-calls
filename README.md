# WebRTC Video Conferencing System

A modern, feature-rich video conferencing application built with WebRTC, Node.js, Express, Socket.IO, and PeerJS.

## 🌟 Features

- **Video Conferencing**: High-quality real-time video calls with multiple participants
- **Screen Sharing**: Share your screen with other participants
- **Interactive Whiteboard**: Collaborate visually with the shared whiteboard
- **Real-time Chat**: Instant messaging with emoji support
- **Responsive Design**: Works on desktop and mobile devices
- **User Management**: Unique usernames and participant tracking
- **Easy Room Creation**: Generate unique room IDs or join existing rooms

## 🛠️ Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), WebRTC
- **Backend**: Node.js, Express.js
- **Real-time Communication**: Socket.IO, PeerJS
- **Templating**: EJS (Embedded JavaScript)
- **UI Framework**: Custom CSS with modern design principles

## 📁 Project Structure

```
.
├── public/                 # Static assets
│   ├── script.js           # Main client-side application logic
│   ├── style.css           # Application styling
│   └── whiteboard.js       # Interactive whiteboard functionality
├── views/                  # EJS templates
│   ├── index.ejs           # Main landing page
│   └── room.ejs            # Conference room page
├── server.js              # Main server application
├── package.json           # Node.js dependencies and scripts
├── .env                   # Environment configuration
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose configuration
└── README.md              # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd webrtc-video-conferencing
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
Create a `.env` file based on the provided `.env.example`:
```env
PORT=3030
NODE_ENV=development
CORS_ORIGIN=*

PEER_HOST=localhost
PEER_PORT=3030
PEER_PATH=/peerjs
PEER_SECURE=false

PING_TIMEOUT=60000
PING_INTERVAL=25000
MAX_ROOM_HISTORY=100
```

4. Start the application:
```bash
npm start
```

5. Open your browser and navigate to `http://localhost:3030`

## 🐳 Docker Support

The application includes Docker configuration for easy deployment:

```bash
# Using Docker Compose (recommended)
docker-compose up -d

# Using Docker directly
docker build -t webrtc-conference .
docker run -p 3030:3030 webrtc-conference
```

## 🔧 Usage

1. **Create a Room**: Click "Create Room" on the main page to generate a new conference room with a unique ID
2. **Join a Room**: Click "Join Room" and enter your username and room ID
3. **Video Controls**:
   - Toggle camera on/off
   - Mute/unmute microphone
   - Share screen with other participants
   - Open/close interactive whiteboard
4. **Chat**: Send messages and emojis to all participants in real-time
5. **Invite Others**: Share the room link with others to invite them

## 🎨 UI Features

- Modern dark theme interface
- Responsive design for all screen sizes
- Intuitive control panel
- Real-time participant indicators
- Animated transitions and feedback
- Customizable whiteboard with drawing tools

## 🔒 Security

- CORS configuration for secure cross-origin requests
- Secure WebSocket connections
- Peer-to-peer communication for video streams
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

- Thanks to the WebRTC, Socket.IO, and PeerJS communities for their excellent documentation and examples
- Inspired by modern video conferencing platforms like Zoom and Google Meet