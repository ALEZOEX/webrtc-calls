# WebRTC Video Conferencing System

A modern, feature-rich video conferencing application built with WebRTC, Node.js, Express, Socket.IO, and SimplePeer.

## 🌟 Features

- **Video Conferencing**: High-quality real-time video calls with multiple participants
- **Screen Sharing**: Share your screen with other participants
- **Real-time Chat**: Instant messaging with emoji support
- **Responsive Design**: Works on desktop and mobile devices
- **User Management**: Unique usernames and participant tracking
- **Easy Room Creation**: Generate unique room IDs or join existing rooms

## 🛠️ Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), WebRTC
- **Backend**: Node.js, Express.js
- **Real-time Communication**: Socket.IO, SimplePeer
- **Templating**: EJS (Embedded JavaScript)
- **UI Framework**: Custom CSS with modern design principles

## 📁 Project Structure

```
.
├── public/                 # Static assets
│   ├── script.js           # Main client-side application logic
│   └── style.css           # Application styling
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

### Environment Configuration

Create a `.env` file in the root directory with the following variables:

```
PORT=3030
NODE_ENV=development
```

### Start the Application

```bash
npm start
```

5. Open your browser and navigate to `http://localhost:3030`

## ☁️ Deployment

### Render.com Deployment

1. Fork this repository to your GitHub account
2. Create a new Web Service on Render.com
3. Connect your GitHub repository
4. Configure the service with these settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables:
     - `NODE_ENV`: `production`
     - `PORT`: `3030`
5. Add your custom domain if needed
6. Deploy the service

### Environment Configuration for Render.com

When deploying to Render.com, make sure to set the following environment variables in your Render dashboard:

```
NODE_ENV = production
PORT = 3030
```

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

- Thanks to the WebRTC, Socket.IO, and SimplePeer communities for their excellent documentation and examples
- Inspired by modern video conferencing platforms like Zoom and Google Meet