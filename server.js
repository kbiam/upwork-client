const express = require('express');
const bodyParser = require('body-parser');
const webrtc = require('wrtc');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const { v4: uuidv4 } = require('uuid'); // Importing UUID for unique IDs

const app = express();
const server = http.createServer(app);
const io = new Server(server,{
  cors: {
    origin: ['http://localhost:3000', "https://client-frontend-sigma.vercel.app/"],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  }
});

let streams = {}; // Store streams by streamer ID
let iceCandidates = {}; // Store ICE candidates by streamer ID

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// app.use('/api', require("./Routes/authRoutes"));

// Serve the static files from the React app
app.use(express.static(path.resolve(__dirname, '../Frontend/build')));

// Handle all GET requests to return the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/build', 'index.html'));
});

app.post('/generate-stream-id', (req, res) => {
  const streamerId = uuidv4(); // Generate unique ID for each stream
  res.json({ streamerId });
});

app.post('/consumer/:streamerId', async (req, res) => {
  const { streamerId } = req.params;
  try {
    const peer = new webrtc.RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stunprotocol.org',
        },
      ],
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        io.emit('new-ice-candidate', {
          candidate: event.candidate,
          role: 'consumer',
          streamerId,
        });
      }
    };
    // console.log(req.body,"body")
    const desc = new webrtc.RTCSessionDescription(req.body);
    console.log('Received SDP:'); // Log the received SDP
    console.log('SDP Type:', desc.type); // Log the SDP type
    await peer.setRemoteDescription(desc);

    console.log(streams)
    if (!streams[streamerId]) {
      return res.status(403).json({ message: 'No Stream to watch' });
    }

    streams[streamerId].getTracks().forEach((track) => peer.addTrack(track, streams[streamerId]));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    const payload = {
      sdp: peer.localDescription,
    };
    res.json(payload);

    if (iceCandidates[streamerId]) {
      iceCandidates[streamerId].forEach(async (candidate) => {
        try {
          await peer.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding ICE candidate:', e);
        }
      });
    }
  } catch (error) {
    console.error('Error in /consumer:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/broadcast/:streamerId', async (req, res) => {
  const { streamerId } = req.params;
  console.log("streamerId",streamerId)
  try {
    const peer = new webrtc.RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stunprotocol.org',
        },
      ],
    });

    peer.ontrack = (e) => handleTrackEvent(e, streamerId);
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        io.emit('new-ice-candidate', {
          candidate: event.candidate,
          role: 'broadcaster',
          streamerId,
        });
      }
    };
    
    const desc = new webrtc.RTCSessionDescription(req.body.sdp);
    // console.log('Received SDP:', desc); // Log the received SDP
    // console.log('SDP Type:', desc.type); // Log the SDP type
    await peer.setRemoteDescription(desc);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    const payload = {
      sdp: peer.localDescription,
    };
    res.json(payload);

    if (iceCandidates[streamerId]) {
      iceCandidates[streamerId].forEach(async (candidate) => {
        try {
          await peer.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding ICE candidate:', e);
        }
      });
    }
  } catch (error) {
    console.error('Error in /broadcast:', error);
    res.status(500).json({ error: error.message });
  }
});


app.post('/ice-candidate/:streamerId', (req, res) => {
  const { candidate, role } = req.body;
  const { streamerId } = req.params;

  if (!iceCandidates[streamerId]) {
    iceCandidates[streamerId] = [];
  }
  iceCandidates[streamerId].push(candidate);
  io.emit('new-ice-candidate', { candidate, role, streamerId });

  res.sendStatus(200);
});

function handleTrackEvent(e, streamerId) {
  if (e.streams && e.streams[0]) {
    console.log("streams[0]",e.streams[0])
    streams[streamerId] = e.streams[0];
    console.log("streams{stremaerId]",streams)

    console.log(`Stream added for streamerId ${streamerId}:`, streams[streamerId]);
  } else {
    console.error(`No stream found in track event for streamerId ${streamerId}`);
  }
}


io.on('connection', (socket) => {
  socket.on('ice-candidate', ({ candidate, streamerId }) => {
    if (!iceCandidates[streamerId]) {
      iceCandidates[streamerId] = [];
    }
    iceCandidates[streamerId].push(candidate);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
