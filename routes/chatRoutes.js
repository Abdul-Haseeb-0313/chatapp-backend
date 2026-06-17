const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { createChat, getChats, getMessages, sendMessage, clearMessages, deleteChat } = require("../controllers/chatController");

const router = express.Router();

router.get("/", authMiddleware, getChats);
router.post("/create", authMiddleware, createChat);
router.get("/:chatId/messages", authMiddleware, getMessages);

router.post("/:chatId/messages", authMiddleware, sendMessage);
router.delete("/:chatId/messages", authMiddleware, clearMessages);
router.delete("/:chatId", authMiddleware, deleteChat);

module.exports = router;
