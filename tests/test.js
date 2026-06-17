const axios = require("axios");

const BASE_URL = "http://localhost:3000";

function pass(msg) {
  console.log(`✅ ${msg}`);
}

function fail(msg) {
  console.log(`❌ ${msg}`);
}

async function run() {
  try {
    const timestamp = Date.now();

    // ==========================
    // SIGNUP USERS
    // ==========================

    const userA = await axios.post(`${BASE_URL}/auth/signup`, {
      username: "UserA",
      email: `a${timestamp}@gmail.com`,
      password: "123456",
    });

    pass("User A signup");

    const userB = await axios.post(`${BASE_URL}/auth/signup`, {
      username: "UserB",
      email: `b${timestamp}@gmail.com`,
      password: "123456",
    });

    pass("User B signup");

    const userC = await axios.post(`${BASE_URL}/auth/signup`, {
      username: "UserC",
      email: `c${timestamp}@gmail.com`,
      password: "123456",
    });

    pass("User C signup");

    const tokenA = userA.data.token;
    const tokenB = userB.data.token;
    const tokenC = userC.data.token;

    // ==========================
    // GET IDS
    // ==========================

    const meA = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    const meB = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    const meC = await axios.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenC}` },
    });

    const userAId = meA.data.id;
    const userBId = meB.data.id;
    const userCId = meC.data.id;

    pass("Fetched all user IDs");

    // ==========================
    // CREATE CHAT A -> B
    // ==========================

    const chatAB = await axios.post(
      `${BASE_URL}/chat/create`,
      {
        participantId: userBId,
      },
      {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      }
    );

    const chatId = chatAB.data.chatId;

    pass("A created chat with B");

    // ==========================
    // DUPLICATE CHAT B -> A
    // ==========================

    const duplicate = await axios.post(
      `${BASE_URL}/chat/create`,
      {
        participantId: userAId,
      },
      {
        headers: {
          Authorization: `Bearer ${tokenB}`,
        },
      }
    );

    if (duplicate.data.chatId === chatId) pass("Duplicate chat prevented");
    else fail("Duplicate chat failed");

    // ==========================
    // SEND MESSAGE A
    // ==========================

    await axios.post(
      `${BASE_URL}/chat/${chatId}/messages`,
      {
        content: "Hello from A",
      },
      {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      }
    );

    pass("A sent message");

    // ==========================
    // B READS
    // ==========================

    const messagesB = await axios.get(`${BASE_URL}/chat/${chatId}/messages`, {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });

    if (messagesB.data.length > 0) pass("B can read messages");
    else fail("B cannot read");

    // ==========================
    // B REPLY
    // ==========================

    await axios.post(
      `${BASE_URL}/chat/${chatId}/messages`,
      {
        content: "Reply from B",
      },
      {
        headers: {
          Authorization: `Bearer ${tokenB}`,
        },
      }
    );

    pass("B replied");

    // ==========================
    // USER C SHOULD FAIL
    // ==========================

    try {
      await axios.get(`${BASE_URL}/chat/${chatId}/messages`, {
        headers: {
          Authorization: `Bearer ${tokenC}`,
        },
      });

      fail("User C accessed messages");
    } catch {
      pass("User C blocked from reading");
    }

    try {
      await axios.post(
        `${BASE_URL}/chat/${chatId}/messages`,
        {
          content: "Hacker message",
        },
        {
          headers: {
            Authorization: `Bearer ${tokenC}`,
          },
        }
      );

      fail("User C sent message");
    } catch {
      pass("User C blocked from sending");
    }

    // ==========================
    // GET CHATS A
    // ==========================

    const chatsA = await axios.get(`${BASE_URL}/chat`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });

    pass("A fetched chats");

    const chatsB = await axios.get(`${BASE_URL}/chat`, {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });

    pass("B fetched chats");

    // ==========================
    // LOGOUT A
    // ==========================

    await axios.post(
      `${BASE_URL}/auth/logout`,
      {},
      {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      }
    );

    pass("A logged out");

    try {
      await axios.get(`${BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
        },
      });

      fail("Old token still works");
    } catch {
      pass("Old token invalidated");
    }

    // B SHOULD STILL WORK

    await axios.get(`${BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });

    pass("User B still alive");

    console.log("\n🔥 ALL TESTS PASSED 🔥");
  } catch (err) {
    console.log(err.response?.data || err.message);
  }
}

run();
