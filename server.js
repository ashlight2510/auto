import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const ROOMS = new Map(); // roomCode -> { players: [socketId], state }

const UNITS = [
  { id: "warrior", emoji: "🗡️", atk: 3, hp: 6, tag: "melee" },
  { id: "tank", emoji: "🛡️", atk: 1, hp: 10, tag: "guard" },
  { id: "archer", emoji: "🏹", atk: 4, hp: 4, tag: "ranged" },
  { id: "bomb", emoji: "💣", atk: 2, hp: 3, tag: "boom" },
  { id: "mage", emoji: "🧙", atk: 3, hp: 5, tag: "boom" },
];

function code() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function makeShop() {
  // 3개 랜덤 제시
  const picks = [];
  while (picks.length < 3) {
    picks.push(UNITS[Math.floor(Math.random() * UNITS.length)]);
  }
  return picks;
}

function initPlayer() {
  return {
    hp: 20,
    gold: 3,
    board: [], // [{...unit, uid}]
    bench: [], // 미사용
    shop: makeShop(),
  };
}

function simulateFight(boardA, boardB) {
  // 매우 단순: 0번끼리 교환 타격, 죽으면 제거. 한쪽 소멸 시 종료.
  const a = boardA.map((u) => ({ ...u }));
  const b = boardB.map((u) => ({ ...u }));

  let i = 0;
  while (a.length && b.length && i < 200) {
    const ua = a[0];
    const ub = b[0];
    ub.hp -= ua.atk;
    ua.hp -= ub.atk;
    if (ua.hp <= 0) a.shift();
    if (ub.hp <= 0) b.shift();
    i++;
  }
  const winner = a.length && !b.length ? "A" : !a.length && b.length ? "B" : "DRAW";
  const remaining = Math.abs(a.length - b.length);
  const dmg = winner === "DRAW" ? 0 : Math.max(1, remaining); // 간단 데미지
  return { winner, dmg, a, b };
}

function broadcastRoom(roomCode) {
  const room = ROOMS.get(roomCode);
  if (!room) return;
  for (const sid of room.players) {
    const idx = room.players.indexOf(sid);
    const you = idx === 0 ? "A" : "B";
    const me = room.state.players[you];
    const op = room.state.players[you === "A" ? "B" : "A"];
    io.to(sid).emit("state", {
      roomCode,
      you,
      me,
      opPublic: {
        hp: op.hp,
        board: op.board.map((x) => ({ emoji: x.emoji, atk: x.atk, hp: x.hp })),
      },
      phase: room.state.phase,
      round: room.state.round,
      phaseEndsAt: room.state.phaseEndsAt,
    });
  }
}

function startRoundTimer(roomCode) {
  const room = ROOMS.get(roomCode);
  if (!room) return;

  room.state.phase = "SHOP";
  room.state.phaseEndsAt = Date.now() + 25000; // 25초
  broadcastRoom(roomCode);

  setTimeout(() => {
    const room2 = ROOMS.get(roomCode);
    if (!room2) return;

    // 전투
    room2.state.phase = "FIGHT";
    room2.state.phaseEndsAt = Date.now() + 20000;
    const { winner, dmg } = simulateFight(
      room2.state.players.A.board,
      room2.state.players.B.board,
    );

    if (winner === "A") room2.state.players.B.hp -= dmg;
    if (winner === "B") room2.state.players.A.hp -= dmg;

    broadcastRoom(roomCode);

    setTimeout(() => {
      const room3 = ROOMS.get(roomCode);
      if (!room3) return;

      // 다음 라운드 준비
      room3.state.round += 1;
      for (const key of ["A", "B"]) {
        const p = room3.state.players[key];
        p.gold = Math.min(10, p.gold + 3);
        p.shop = makeShop();
      }
      // 종료 체크
      const aDead = room3.state.players.A.hp <= 0;
      const bDead = room3.state.players.B.hp <= 0;
      if (aDead || bDead || room3.state.round > 12) {
        room3.state.phase = "END";
        room3.state.winner =
          aDead && bDead
            ? "DRAW"
            : aDead
              ? "B"
              : bDead
                ? "A"
                : "POINTS";
        broadcastRoom(roomCode);
        return;
      }

      startRoundTimer(roomCode);
    }, 5000); // 결과 5초
  }, 25000);
}

io.on("connection", (socket) => {
  socket.on("createRoom", () => {
    let roomCode = code();
    while (ROOMS.has(roomCode)) roomCode = code();
    ROOMS.set(roomCode, {
      players: [socket.id],
      state: { round: 1, phase: "WAIT", players: { A: initPlayer(), B: initPlayer() } },
    });
    socket.join(roomCode);
    socket.emit("roomJoined", { roomCode, role: "A" });
  });

  socket.on("joinRoom", ({ roomCode }) => {
    const room = ROOMS.get(roomCode);
    if (!room) return socket.emit("err", "방이 없어요.");
    if (room.players.length >= 2) return socket.emit("err", "방이 꽉 찼어요.");
    room.players.push(socket.id);
    socket.join(roomCode);
    socket.emit("roomJoined", { roomCode, role: "B" });

    // 2명 모이면 시작
    room.state.phase = "SHOP";
    broadcastRoom(roomCode);
    startRoundTimer(roomCode);
  });

  socket.on("buy", ({ roomCode, unitId }) => {
    const room = ROOMS.get(roomCode);
    if (!room || room.state.phase !== "SHOP") return;

    const idx = room.players.indexOf(socket.id);
    const key = idx === 0 ? "A" : "B";
    const p = room.state.players[key];

    const pick = p.shop.find((u) => u.id === unitId);
    if (!pick) return;
    if (p.gold < 3) return;

    if (p.board.length >= 5) return socket.emit("err", "보드가 가득 찼어요(최대 5).");

    p.gold -= 3;
    p.board.push({ ...pick, uid: crypto.randomUUID() });

    // 같은 유닛 3개면 별업(간단)
    const same = p.board.filter((x) => x.id === unitId);
    if (same.length >= 3) {
      // 3개 제거하고 1개 강화 생성
      let removed = 0;
      p.board = p.board.filter((x) => {
        if (x.id === unitId && removed < 3) {
          removed++;
          return false;
        }
        return true;
      });
      p.board.push({
        ...pick,
        uid: crypto.randomUUID(),
        atk: pick.atk + 2,
        hp: pick.hp + 4,
        emoji: "⭐" + pick.emoji,
      });
    }

    // 구매한 건 상점에서 제거(간단)
    p.shop = p.shop.filter((u) => u.id !== unitId);
    broadcastRoom(roomCode);
  });

  socket.on("reroll", ({ roomCode }) => {
    const room = ROOMS.get(roomCode);
    if (!room || room.state.phase !== "SHOP") return;

    const idx = room.players.indexOf(socket.id);
    const key = idx === 0 ? "A" : "B";
    const p = room.state.players[key];
    if (p.gold < 1) return;

    p.gold -= 1;
    p.shop = makeShop();
    broadcastRoom(roomCode);
  });

  socket.on("disconnect", () => {
    // 방 정리(간단)
    for (const [roomCode, room] of ROOMS) {
      const i = room.players.indexOf(socket.id);
      if (i >= 0) {
        room.players.splice(i, 1);
        io.to(roomCode).emit("err", "상대가 나갔어요.");
        ROOMS.delete(roomCode);
      }
    }
  });
});

server.listen(3000, () => console.log("http://localhost:3000"));
