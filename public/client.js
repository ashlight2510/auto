const socket = io();

let roomCode = null;

const $ = (id) => document.getElementById(id);

$("btnCreate").onclick = () => socket.emit("createRoom");
$("btnJoin").onclick = () => {
  const code = $("roomCode").value.trim().toUpperCase();
  if (!code) return;
  socket.emit("joinRoom", { roomCode: code });
};
$("btnReroll").onclick = () => {
  if (!roomCode) return;
  socket.emit("reroll", { roomCode });
};

socket.on("roomJoined", ({ roomCode: rc }) => {
  roomCode = rc;
  $("lobbyMsg").textContent = `방 코드: ${roomCode} (친구에게 보내서 입장시키세요)`;
  $("meta").textContent = `ROOM ${roomCode}`;
  $("lobby").classList.remove("hidden");
});

socket.on("err", (m) => {
  $("lobbyMsg").textContent = m;
  $("msg").textContent = m;
});

socket.on("state", ({ roomCode: rc, me, opPublic, phase, round, phaseEndsAt }) => {
  roomCode = rc;
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");

  $("myHp").textContent = `내 HP: ${me.hp}`;
  $("myGold").textContent = `골드: ${me.gold}`;
  $("opHp").textContent = `상대 HP: ${opPublic.hp}`;
  $("phase").textContent = `라운드 ${round} · ${phase}`;

  if (phaseEndsAt) {
    const seconds = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    $("meta").textContent = `ROOM ${roomCode} · ${seconds}s`;
  }

  renderBoard("myBoard", me.board);
  renderBoard("opBoard", opPublic.board);
  renderShop(me.shop || []);
});

function renderBoard(elId, units) {
  const el = $(elId);
  el.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const u = units[i];
    if (u) slot.appendChild(unitCard(u));
    el.appendChild(slot);
  }
}

function renderShop(shop) {
  const el = $("shop");
  el.innerHTML = "";
  shop.forEach((u) => {
    const card = unitCard(u);
    card.style.cursor = "pointer";
    card.onclick = () => socket.emit("buy", { roomCode, unitId: u.id });
    el.appendChild(card);
  });
}

function unitCard(u) {
  const d = document.createElement("div");
  d.className = "unit";
  d.innerHTML = `
    <div class="e">${u.emoji}</div>
    <div class="s">ATK ${u.atk} • HP ${u.hp}</div>
  `;
  return d;
}
