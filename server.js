const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const webrtc = require("wrtc");
const path = require("path");
const cors = require("cors");

let senderStream;
let consumers = [];

const allowedOrigins = [
  'https://client-frontend-dz4k86j81-kushs-projects-deed01fb.vercel.app/'
]
const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true
};

// Apply CORS middleware to all routes
app.use(cors(corsOptions));

// Preflight request handling
app.options('*', cors(corsOptions));app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let broadcasterPeer = null;

app.use(express.static(path.resolve(__dirname, "../Frontend/build")));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, "../Frontend/build", "index.html"));
});

app.post("/broadcast", async ({ body }, res) => {
  try {
    const peer = new webrtc.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.stunprotocol.org" }],
    });

    peer.ontrack = (e) => handleTrackEvent(e, peer);
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        handleBroadcasterIceCandidate(event.candidate);
      }
    };

    const desc = new webrtc.RTCSessionDescription(body.sdp);
    await peer.setRemoteDescription(desc);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    broadcasterPeer = peer;

    const payload = { sdp: peer.localDescription };
    res.json(payload);
  } catch (error) {
    console.error("Error in /broadcast:", error);
    res.status(500).json({ error: error.message });
  }
});

function handleTrackEvent(e, peer) {
  senderStream = e.streams[0];
  consumers.forEach((consumer) => {
    if (!consumer.tracksAdded) {
      senderStream.getTracks().forEach((track) => consumer.addTrack(track, senderStream));
      consumer.tracksAdded = true;
    }
  });
}

function handleBroadcasterIceCandidate(candidate) {
  consumers.forEach((consumer) => {
    consumer.addIceCandidate(new webrtc.RTCIceCandidate(candidate)).catch(console.error);
  });
}

app.post("/consumer", async ({ body }, res) => {
  try {
    const peer = new webrtc.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.stunprotocol.org" }],
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        handleConsumerIceCandidate(event.candidate);
      }
    };

    const desc = new webrtc.RTCSessionDescription(body.sdp);
    await peer.setRemoteDescription(desc);

    if (!senderStream) {
      return res.status(404).json({ message: "No Stream to watch" });
    }

    senderStream.getTracks().forEach((track) => peer.addTrack(track, senderStream));

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    const payload = { sdp: peer.localDescription };
    res.json(payload);

    consumers.push(peer);
  } catch (error) {
    console.error("Error in /consumer:", error);
    res.status(500).json({ error: error.message });
  }
});

function handleConsumerIceCandidate(candidate) {
  if (broadcasterPeer) {
    broadcasterPeer.addIceCandidate(new webrtc.RTCIceCandidate(candidate)).catch(console.error);
  }
}

app.post("/ice-candidate", (req, res) => {
  const { candidate, role } = req.body;
  const iceCandidate = new webrtc.RTCIceCandidate(candidate);

  if (role === 'broadcaster') {
    handleBroadcasterIceCandidate(iceCandidate);
  } else if (role === 'consumer') {
    handleConsumerIceCandidate(iceCandidate);
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
