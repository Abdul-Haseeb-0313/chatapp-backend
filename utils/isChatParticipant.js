const prisma = require("../prisma");

const isChatParticipant = async (chatId, userId) => {
  const numericChatId = Number(chatId);
  if (isNaN(numericChatId)) return false;

  const participant = await prisma.chat_participants.findFirst({
    where: {
      chat_id: numericChatId,
      user_id: userId,
    },
  });

  return participant !== null;
};

module.exports = isChatParticipant;
