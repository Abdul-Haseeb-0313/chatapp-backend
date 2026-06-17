const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");


const prisma = require("../prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/me", authMiddleware, (req, res) => {
  res.json(req.user);
});

router.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  const existingUser = await prisma.users.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    return res.status(400).json({
      message: "User already exists",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.users.create({
    data: {
      username,
      email,
      password_hash: hashedPassword,
    },
  });

  const token = jwt.sign(
    {
      userId: user.id,
      tokenVersion: user.token_version,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "5d",
    }
  );

  res.json({
    token,
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.users.findUnique({
    where: {
      email,
    },
  });

 if (!user) {
   return res.status(404).json({
     message: "User does not exist",
   });
 }

  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    return res.status(400).json({
      message: "Invalid credentials",
    });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      tokenVersion: user.token_version,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "5d",
    }
  );

  res.json({
    token,
  });
});

router.post("/logout", authMiddleware, async (req, res) => {
  await prisma.users.update({
    where: {
      id: req.user.id,
    },
    data: {
      token_version: {
        increment: 1,
      },
    },
  });

  res.json({
    message: "Logged out successfully",
  });
});

module.exports = router;