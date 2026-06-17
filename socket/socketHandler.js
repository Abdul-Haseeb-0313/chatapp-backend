const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const isChatParticipant = require("../utils/isChatParticipant");

const onlineUsers = new Set();
const userSockets = new Map();

function socketHandler(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("No token provided"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`User ${userId} connected`);

    userSockets.set(userId, socket);
    onlineUsers.add(userId);

    const userChats = await prisma.chat_participants.findMany({
      where: { user_id: userId },
    });

    const chatIds = userChats.map((c) => c.chat_id);

    for (const chat of userChats) {
      socket.join(`chat_${chat.chat_id}`);
    }

    console.log(`User ${userId} joined ${chatIds.length} rooms`);

    // Broadcast own online status
    for (const chatId of chatIds) {
      io.to(`chat_${chatId}`).emit("user_online", { userId });
    }

    // Inform new socket about already online users in their chats
    if (chatIds.length > 0) {
      const otherParticipants = await prisma.chat_participants.findMany({
        where: {
          chat_id: { in: chatIds },
          user_id: { not: userId },
        },
      });

      const onlineOthers = new Set(
        otherParticipants
          .filter((p) => onlineUsers.has(p.user_id))
          .map((p) => p.user_id)
      );

      for (const otherId of onlineOthers) {
        socket.emit("user_online", { userId: otherId });
      }
    }

    // ========================
    // REQUEST ONLINE STATUS (for reconnection / refresh)
    // ========================
    socket.on("get_online_users", async () => {
      try {
        // Get all chats the user is part of
        const userChats = await prisma.chat_participants.findMany({
          where: { user_id: userId },
        });

        if (userChats.length === 0) return;

        const chatIds = userChats.map((c) => c.chat_id);

        // Get all other participants in those chats
        const otherParticipants = await prisma.chat_participants.findMany({
          where: {
            chat_id: { in: chatIds },
            user_id: { not: userId },
          },
        });

        // Filter to only those currently online
        const onlineOthers = otherParticipants
          .filter((p) => onlineUsers.has(p.user_id))
          .map((p) => p.user_id);

        // Remove duplicates (if user is in multiple chats with the same person)
        const uniqueOnline = [...new Set(onlineOthers)];

        // Send back to the requesting socket only
        socket.emit("online_users_list", { userIds: uniqueOnline });
      } catch (err) {
        console.error("get_online_users error:", err);
      }
    });

    // ========================
    // SEND MESSAGE
    // ========================
    socket.on("send_message", async (data) => {
      try {
        if (!userId) return;

        // Check if chat still exists and user is a participant
        const chatExists = await prisma.chats.findUnique({
          where: { id: data.chatId },
        });

        if (!chatExists) {
          // Chat was deleted – notify this socket to remove it
          socket.emit("chat_deleted", { chatId: data.chatId });
          return;
        }

        const allowed = await isChatParticipant(data.chatId, userId);
        if (!allowed) {
          // User no longer a participant (should not happen if chat exists, but just in case)
          socket.emit("chat_deleted", { chatId: data.chatId });
          return;
        }

        const savedMessage = await prisma.messages.create({
          data: {
            chat_id: data.chatId,
            sender_id: userId,
            content: data.content,
          },
          include: { users: true },
        });

        const messagePayload = {
          id: savedMessage.id,
          chatId: savedMessage.chat_id,
          senderId: savedMessage.sender_id,
          senderName: savedMessage.users.username,
          content: savedMessage.content,
          createdAt: savedMessage.created_at,
          tempId: data.tempId,
        };

        io.to(`chat_${data.chatId}`).emit("receive_message", messagePayload);
      } catch (err) {
        console.error("send_message error:", err);
      }
    });

    // ========================
    // TYPING INDICATORS
    // ========================
    socket.on("typing", async (data) => {
      const { chatId } = data;
      const allowed = await isChatParticipant(chatId, userId);
      if (!allowed) return;
      socket.to(`chat_${chatId}`).emit("user_typing", { userId, chatId });
    });

    socket.on("stop_typing", async (data) => {
      const { chatId } = data;
      const allowed = await isChatParticipant(chatId, userId);
      if (!allowed) return;
      socket
        .to(`chat_${chatId}`)
        .emit("user_stopped_typing", { userId, chatId });
    });

    // ========================
    // MARK MESSAGES AS READ
    // ========================
    socket.on("mark_read", async (data) => {
      const { chatId } = data;
      try {
        const allowed = await isChatParticipant(chatId, userId);
        if (!allowed) return;
        await prisma.chat_read_status.upsert({
          where: {
            chat_id_user_id: { chat_id: chatId, user_id: userId },
          },
          update: { last_read_at: new Date() },
          create: {
            chat_id: chatId,
            user_id: userId,
            last_read_at: new Date(),
          },
        });
      } catch (err) {
        console.error("mark_read error:", err);
      }
    });

    // ========================
    // DISCONNECT
    // ========================
    socket.on("disconnect", () => {
      console.log(`User ${userId} disconnected`);
      userSockets.delete(userId);
      onlineUsers.delete(userId);

      for (const chatId of chatIds) {
        io.to(`chat_${chatId}`).emit("user_offline", { userId });
      }
    });
  });

  // Helper to join a user to a chat room + notify online status
  io.joinUserToChatRoom = (userId, chatId, otherUserId) => {
    const socket = userSockets.get(userId);
    if (!socket) return;
    socket.join(`chat_${chatId}`);
    if (onlineUsers.has(otherUserId)) {
      socket.emit("user_online", { userId: otherUserId });
    }
  };
}

module.exports = socketHandler;
