require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const express = require("express");

const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const socketHandler = require("./socket/socketHandler");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/chat", chatRoutes);

const server = http.createServer(app);

// Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*", // your frontend URL
    methods: ["GET", "POST"],
  },
});

// Make io accessible to controllers via req.app.get('io')
app.set("io", io);

// Pass io to socket handler
socketHandler(io);

server.listen(3000, () => {
  console.log("Server running");
});
