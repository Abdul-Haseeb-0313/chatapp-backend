const prisma = require("../prisma");
const isChatParticipant = require("../utils/isChatParticipant");

// Helper to parse chatId from route parameter (must be a number)
const parseChatId = (id) => {
  const num = Number(id);
  if (isNaN(num)) throw new Error("Invalid chat ID");
  return num;
};

exports.getChats = async (req, res) => {
  try {
    const userId = req.user.id;

    const chats = await prisma.chat_participants.findMany({
      where: { user_id: userId },
      include: {
        chats: {
          include: {
            chat_participants: {
              include: { users: true },
            },
            messages: {
              orderBy: { created_at: "desc" },
              take: 1,
            },
            chat_read_status: {
              where: { user_id: userId },
              take: 1,
            },
          },
        },
      },
    });

    const formatted = chats.map((cp) => {
      const chat = cp.chats;
      const otherParticipant = chat.chat_participants.find(
        (p) => p.user_id !== userId
      );
      const lastMessage = chat.messages[0]?.content || null;

      // Calculate unread count
      let unreadCount = 0;
      const readStatus = chat.chat_read_status[0];
      if (lastMessage) {
        if (readStatus) {
          // Count messages newer than last_read_at and not from self
          // We already only fetch 1 message; ideally we'd count all unseen.
          // Simpler: we can count all messages in chat that are newer than readStatus.last_read_at
          // But to keep it light, we'll just send 1 if the latest message is from another user and newer than last_read_at.
          // The frontend already handles unread bumps via socket; the initial load can trust this.
          // We'll use the presence of a last message + read status timestamp.
        }
        // For a simple implementation, unreadCount is managed client-side, but to persist across refreshes,
        // we could use the number of messages after the last_read_at.
        // I'll provide a small efficient query.
      }

      // Efficient unread count: count messages where created_at > last_read_at and sender_id != userId
      // We'll do a separate query for each chat – but can batch later.
      // To keep it simple: leave as 0 for now (or we do a batch count).
      // Instead, we'll later execute a batch query, but for now stick with unreadCount = 0 because the client state can start empty on refresh.
      // Actually the user wants unread to persist. Let's do a single query to get all unread counts.

      // --- After this map, we'll add a batch unread count query. For simplicity, I'll adjust the code.

      return {
        id: chat.id,
        name: otherParticipant?.users.username || "Unknown",
        otherUserId: otherParticipant?.user_id,
        lastMessage,
        lastMessageAt: chat.messages[0]?.created_at || chat.created_at,
        unreadCount, // placeholder, will be replaced below
      };
    });

    // Batch get unread counts for all chats
    const chatIds = formatted.map((c) => c.id);
    if (chatIds.length > 0) {
      const lastReads = await prisma.chat_read_status.findMany({
        where: {
          chat_id: { in: chatIds },
          user_id: userId,
        },
      });
      const readMap = {};
      for (const r of lastReads) {
        readMap[r.chat_id] = r.last_read_at;
      }

      // For each chat, count messages after last read time
      const unreadCounts = await Promise.all(
        chatIds.map(async (chatId) => {
          const lastRead = readMap[chatId] || new Date(0); // epoch if never read
          return prisma.messages.count({
            where: {
              chat_id: chatId,
              created_at: { gt: lastRead },
              sender_id: { not: userId },
            },
          });
        })
      );
      formatted.forEach((c, idx) => {
        c.unreadCount = unreadCounts[idx];
      });
    }

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /chat/create – create a new chat and notify participants correctly
exports.createChat = async (req, res) => {
  try {
    const { email } = req.body;
    const creatorId = req.user.id;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Find the other user
    const otherUser = await prisma.users.findUnique({
      where: { email },
    });

    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (otherUser.id === creatorId) {
      return res.status(400).json({ message: "Cannot chat with yourself" });
    }

    // Check if chat already exists between these two users
    const existingChat = await prisma.chats.findFirst({
      where: {
        chat_participants: {
          every: {
            user_id: { in: [creatorId, otherUser.id] },
          },
        },
      },
      include: {
        chat_participants: {
          include: { users: true },
        },
      },
    });

    if (existingChat) {
      const otherParticipant = existingChat.chat_participants.find(
        (p) => p.user_id !== creatorId
      );
      return res.json({
        id: existingChat.id,
        name: otherParticipant?.users.username || "Unknown",
        otherUserId: otherParticipant?.user_id,
      });
    }

    // Create new chat and add both participants
    const chat = await prisma.chats.create({
      data: {
        chat_participants: {
          create: [{ user_id: creatorId }, { user_id: otherUser.id }],
        },
      },
      include: {
        chat_participants: {
          include: { users: true },
        },
      },
    });

    const creatorParticipant = chat.chat_participants.find(
      (p) => p.user_id === creatorId
    );
    const otherParticipant = chat.chat_participants.find(
      (p) => p.user_id === otherUser.id
    );

    // Data for the creator: they see the recipient's name
    const creatorView = {
      id: chat.id,
      name: otherParticipant?.users.username || "Unknown",
      otherUserId: otherParticipant?.user_id,
    };

    // Data for the recipient: they see the creator's name
    const recipientView = {
      id: chat.id,
      name: creatorParticipant?.users.username || "Unknown",
      otherUserId: creatorParticipant?.user_id,
    };

    // ---- Real‑time logic ----
    const io = req.app.get("io");

    // Join both users to the new room
    if (io.joinUserToChatRoom) {
      io.joinUserToChatRoom(creatorId, chat.id, otherUser.id);
      io.joinUserToChatRoom(otherUser.id, chat.id, creatorId);
    }

    // Send personalised "new_chat" events to each socket
    const sockets = await io.fetchSockets();
    const creatorSocket = sockets.find((s) => s.userId === creatorId);
    const otherSocket = sockets.find((s) => s.userId === otherUser.id);

    if (creatorSocket) creatorSocket.emit("new_chat", creatorView);
    if (otherSocket) otherSocket.emit("new_chat", recipientView);

    // Respond with the creator's view for the API caller
    res.json(creatorView);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /chat/:chatId/messages – fetch messages (chatId converted to number)
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = parseChatId(req.params.chatId);

    const allowed = await isChatParticipant(chatId, userId);
    if (!allowed) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const messages = await prisma.messages.findMany({
      where: { chat_id: chatId },
      orderBy: { created_at: "asc" },
      include: { users: true },
    });

    const formatted = messages.map((m) => ({
      id: m.id,
      chatId: m.chat_id,
      senderId: m.sender_id,
      senderName: m.users.username,
      content: m.content,
      createdAt: m.created_at,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /chat/:chatId/messages – fallback (not used by frontend, but safe)
exports.sendMessage = async (req, res) => {
  try {
    const chatId = parseChatId(req.params.chatId);
    const userId = req.user.id;
    const { content } = req.body;

    const allowed = await isChatParticipant(chatId, userId);
    if (!allowed) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const message = await prisma.messages.create({
      data: { chat_id: chatId, sender_id: userId, content },
      include: { users: true },
    });

    const payload = {
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      senderName: message.users.username,
      content: message.content,
      createdAt: message.created_at,
    };

    const io = req.app.get("io");
    if (io) io.to(`chat_${chatId}`).emit("receive_message", payload);

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE /chat/:chatId/messages – clear all messages in a chat
exports.clearMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = parseChatId(req.params.chatId);

    const allowed = await isChatParticipant(chatId, userId);
    if (!allowed) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // Delete all messages in this chat
    await prisma.messages.deleteMany({
      where: { chat_id: chatId },
    });

    res.json({ message: "Chat cleared successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE /chat/:chatId – delete the entire chat (messages, participants, chat)
exports.deleteChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = parseChatId(req.params.chatId);

    const allowed = await isChatParticipant(chatId, userId);
    if (!allowed) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // Delete all messages for this chat
    await prisma.messages.deleteMany({
      where: { chat_id: chatId },
    });

    // Delete all participants
    await prisma.chat_participants.deleteMany({
      where: { chat_id: chatId },
    });

    // Delete read statuses
    await prisma.chat_read_status.deleteMany({
      where: { chat_id: chatId },
    });

    // Finally delete the chat itself
    await prisma.chats.delete({
      where: { id: chatId },
    });

    // Notify the other participant via socket (optional)
    const io = req.app.get("io");
    if (io) {
      io.to(`chat_${chatId}`).emit("chat_deleted", { chatId });
    }

    res.json({ message: "Chat deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
