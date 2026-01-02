const $ = (id) => document.getElementById(id);

const UNITS = [
  { id: "warrior", emoji: "🗡️", atk: 3, hp: 7, tag: "melee" },
  { id: "tank", emoji: "🛡️", atk: 2, hp: 11, tag: "guard", armor: 1, taunt: true },
  { id: "archer", emoji: "🏹", atk: 4, hp: 5, tag: "ranged", crit: 0.2 },
  { id: "bomb", emoji: "💣", atk: 3, hp: 4, tag: "boom", boom: 2 },
  { id: "mage", emoji: "🧙", atk: 3, hp: 5, tag: "boom", aoe: 0.18, aoeDmg: 2 },
  { id: "healer", emoji: "💉", atk: 2, hp: 6, tag: "support", heal: 2 },
];

const TAG_RULES = {
  guard: {
    name: "🛡️ 수호",
    tiers: [
      { count: 2, bonus: { hp: 2, armor: 1 } },
      { count: 4, bonus: { hp: 5, armor: 2 } },
    ],
  },
  melee: {
    name: "🗡️ 근접",
    tiers: [
      { count: 2, bonus: { atk: 1, hp: 1 } },
      { count: 4, bonus: { atk: 2, hp: 3 } },
    ],
  },
  ranged: {
    name: "🏹 사격",
    tiers: [
      { count: 2, bonus: { atk: 1, crit: 0.08 } },
      { count: 4, bonus: { atk: 2, crit: 0.16 } },
    ],
  },
  boom: {
    name: "💥 폭발",
    tiers: [
      { count: 2, bonus: { boom: 1, aoe: 0.08 } },
      { count: 4, bonus: { boom: 3, aoe: 0.16 } },
    ],
  },
  support: {
    name: "💉 지원",
    tiers: [
      { count: 2, bonus: { heal: 1 } },
      { count: 4, bonus: { heal: 3 } },
    ],
  },
};
const TAG_EMOJI = {
  guard: "🛡️",
  melee: "🗡️",
  ranged: "🏹",
  boom: "💥",
  support: "💉",
};

const ROUND_COUNT = 12;
const SHOP_MS = 25000;
const FIGHT_MS = 20000;
const RESULT_MS = 5000;
const MAX_SHOP_LEVEL = 4;
const FIGHT_TICK_MS = 500;

const DIFFICULTY = {
  easy: { label: "쉬움", rerolls: 0, bonusGold: 0, smart: 0 },
  normal: { label: "보통", rerolls: 1, bonusGold: 0, smart: 1 },
  hard: { label: "어려움", rerolls: 2, bonusGold: 1, smart: 1 },
};

const AI_NAMES = {
  easy: "🤖 연습봇",
  normal: "🤖 전술봇",
  hard: "🤖 정예봇",
};

let state = null;
let timerId = null;
let tickId = null;
let logEntries = [];
let endTimeoutId = null;
let combatState = null;
let fastForward = false;
let soundEnabled = false;
let audioCtx = null;
let lastHitSoundAt = 0;
let lastImpactAt = 0;

const RECORD_KEY = "emojiBattlerRecord";

$("btnStart").onclick = () => startGame();
$("btnSound").onclick = () => toggleSound();
$("btnReroll").onclick = () => {
  if (!state || state.phase !== "SHOP") return;
  if (state.me.gold < 1) return;
  state.me.gold -= 1;
  state.me.shop = makeShop(state.me.shopLevel);
  render();
};
$("btnLevel").onclick = () => {
  if (!state || state.phase !== "SHOP") return;
  const cost = shopLevelCost(state.me.shopLevel);
  if (state.me.shopLevel >= MAX_SHOP_LEVEL) return;
  if (state.me.gold < cost) return;
  state.me.gold -= cost;
  state.me.shopLevel += 1;
  state.me.shop = makeShop(state.me.shopLevel);
  render();
};
$("btnSkip").onclick = () => advancePhase();

function startGame() {
  clearTimers();
  logEntries = [];
  $("lobbyMsg").textContent = "싱글 모드 데모(멀티는 나중에 연동).";
  const difficulty = $("difficulty").value;
  state = {
    round: 1,
    phase: "SHOP",
    phaseEndsAt: Date.now() + SHOP_MS,
    settings: {
      difficulty,
      aiName: AI_NAMES[difficulty],
    },
    me: initPlayer("YOU"),
    op: initPlayer("AI"),
  };
  state.op.gold += DIFFICULTY[difficulty].bonusGold;
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("msg").textContent = "";
  enterShop();
  render();
  playSound("start");
}

function enterShop() {
  clearTimers();
  state.phase = "SHOP";
  state.phaseEndsAt = Date.now() + SHOP_MS;
  combatState = null;
  fastForward = false;
  aiTakeShopTurn(state.op);
  render();
  timerId = setTimeout(enterFight, SHOP_MS);
  tickId = setInterval(render, 1000);
  playSound("phase");
}

function enterFight() {
  clearTimers();
  state.phase = "FIGHT";
  state.phaseEndsAt = Date.now() + FIGHT_MS;
  combatState = createCombatState();
  fastForward = false;
  render();
  timerId = setTimeout(() => finishCombat(), FIGHT_MS);
  tickId = setInterval(combatTick, FIGHT_TICK_MS);
  playSound("phase");
}

function enterResult() {
  clearTimers();
  state.phase = "RESULT";
  state.phaseEndsAt = Date.now() + RESULT_MS;
  render();
  timerId = setTimeout(endRound, RESULT_MS);
  tickId = setInterval(render, 1000);
  playSound("phase");
}

function endRound() {
  clearTimers();
  if (state.me.hp <= 0 || state.op.hp <= 0 || state.round >= ROUND_COUNT) {
    endGame();
    return;
  }
  const income = 2 + Math.min(5, Math.floor(state.round / 2));
  state.round += 1;
  state.me.gold = Math.min(10, state.me.gold + income);
  state.op.gold = Math.min(10, state.op.gold + income + DIFFICULTY[state.settings.difficulty].bonusGold);
  state.me.shop = makeShop(state.me.shopLevel);
  state.op.shop = makeShop(state.op.shopLevel);
  enterShop();
}

function advancePhase() {
  if (!state) return;
  if (state.phase === "SHOP") return enterFight();
  if (state.phase === "FIGHT") {
    fastForward = true;
    return;
  }
  if (state.phase === "RESULT") return endRound();
}

function clearTimers() {
  if (timerId) clearTimeout(timerId);
  if (tickId) clearInterval(tickId);
  if (endTimeoutId) clearTimeout(endTimeoutId);
  timerId = null;
  tickId = null;
  endTimeoutId = null;
}

function initPlayer(name) {
  return {
    name,
    hp: 20,
    gold: 3,
    board: [],
    shopLevel: 1,
    shop: makeShop(1),
  };
}

function makeShop(level) {
  const picks = [];
  while (picks.length < 3) {
    picks.push(weightedPick(level));
  }
  return picks;
}

function aiTakeShopTurn(p) {
  if (!state) return;
  const diff = DIFFICULTY[state.settings.difficulty];
  maybeLevelUpShop(p, diff);
  let rerolls = diff.rerolls;
  while (rerolls > 0 && p.gold >= 1) {
    const bestScore = bestPickScore(p, p.shop);
    if (bestScore >= 12) break;
    p.gold -= 1;
    p.shop = makeShop(p.shopLevel);
    rerolls -= 1;
  }
  while (p.gold >= 3 && p.shop.length) {
    const pick = pickBestUnit(p, p.shop);
    if (!pick) break;
    if (p.board.length >= 5 && countById(p.board, pick.id) < 2) break;
    buyUnitForPlayer(p, pick.id);
  }
  arrangeBoard(p);
}

function pickBestUnit(p, shop) {
  if (!shop.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const u of shop) {
    const score = scorePick(p, u);
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

function bestPickScore(p, shop) {
  return Math.max(...shop.map((u) => scorePick(p, u)));
}

function scorePick(p, unit) {
  const counts = countTags(p.board);
  const idCount = countById(p.board, unit.id);
  const tagCount = counts[unit.tag] || 0;
  const future = tagCount + 1;
  let score = unit.atk * 2 + unit.hp;
  if (idCount === 2) score += 8; // 별업 가능
  if (future === 2) score += 6;
  if (future === 3) score += 3;
  if (future === 4) score += 8;
  return score;
}

function buyUnitForPlayer(p, unitId) {
  const pick = p.shop.find((u) => u.id === unitId);
  if (!pick) return;
  if (p.gold < 3) return;
  if (p.board.length >= 5 && countById(p.board, unitId) < 2) return;

  p.gold -= 3;
  p.board.push({ ...pick, uid: crypto.randomUUID() });

  const same = p.board.filter((x) => x.id === unitId);
  if (same.length >= 3) {
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
  p.shop = p.shop.filter((u) => u.id !== unitId);
}

function arrangeBoard(p) {
  const order = { guard: 1, melee: 2, boom: 3, ranged: 4, support: 5 };
  p.board.sort((a, b) => (order[a.tag] || 9) - (order[b.tag] || 9));
}

function createCombatState() {
  logEntries = [];
  const a = prepareCombatSide(state.me);
  const b = prepareCombatSide(state.op);
  return {
    a,
    b,
    lastHitA: null,
    lastHitB: null,
    lastAtkA: null,
    lastAtkB: null,
    steps: 0,
    finished: false,
    winner: "DRAW",
    dmg: 0,
  };
}

function combatTick() {
  if (!combatState || combatState.finished) return;
  const stepsPerTick = fastForward ? 8 : 1;
  for (let i = 0; i < stepsPerTick; i++) {
    if (combatState.finished) break;
    stepCombat();
  }
  render();
}

function stepCombat() {
  const aUnits = combatState.a.units;
  const bUnits = combatState.b.units;
  if (!aUnits.length || !bUnits.length) {
    return finishCombat();
  }

  const ua = aUnits[0];
  const ub = bUnits[0];
  const uaAlive = ua && ua.hp > 0;
  const ubAlive = ub && ub.hp > 0;

  if (uaAlive) {
    combatState.lastAtkA = ua.uid;
    const hit = executeAttack(ua, bUnits);
    if (hit) {
      combatState.lastHitB = hit.id || combatState.lastHitB;
      impact("opBoard", hit.crit);
      playSound("hit");
    }
  }
  if (ubAlive) {
    combatState.lastAtkB = ub.uid;
    const hit = executeAttack(ub, aUnits);
    if (hit) {
      combatState.lastHitA = hit.id || combatState.lastHitA;
      impact("myBoard", hit.crit);
      playSound("hit");
    }
  }

  resolveAllDeaths(aUnits, bUnits);

  combatState.steps += 1;
  if (!aUnits.length || !bUnits.length || combatState.steps >= 200) {
    finishCombat();
  }
}

function finishCombat() {
  if (!combatState || combatState.finished) return;
  combatState.finished = true;
  clearTimers();

  const aUnits = combatState.a.units;
  const bUnits = combatState.b.units;
  const winner = aUnits.length && !bUnits.length ? "ME" : !aUnits.length && bUnits.length ? "OP" : "DRAW";
  const remaining = Math.abs(aUnits.length - bUnits.length);
  const dmg = winner === "DRAW" ? 0 : Math.max(1, remaining);
  combatState.winner = winner;
  combatState.dmg = dmg;

  if (winner === "ME") state.op.hp -= dmg;
  if (winner === "OP") state.me.hp -= dmg;

  const reward = winner === "DRAW" ? 1 : 2;
  if (winner === "ME") state.me.gold = Math.min(10, state.me.gold + reward);
  if (winner === "OP") state.op.gold = Math.min(10, state.op.gold + reward);
  if (winner === "ME") pulse("myGold");
  if (winner === "OP") pulse("opHp");

  addLog(
    winner === "DRAW" ? "무승부!" : winner === "ME" ? `승리! 데미지 ${dmg}` : `패배! 데미지 ${dmg}`,
  );
  if (winner === "ME") playSound("win");
  if (winner === "OP") playSound("lose");

  enterResult();
}

function prepareCombatSide(p) {
  const counts = countTags(p.board);
  const tagBonus = buildTagBonuses(counts);
  const units = p.board.map((u) => {
    const bonus = tagBonus[u.tag] || {};
    const maxHp = u.hp + (bonus.hp || 0);
    return {
      ...u,
      hp: maxHp,
      maxHp,
      atk: u.atk + (bonus.atk || 0),
      crit: Math.min(0.45, (u.crit || 0) + (bonus.crit || 0)),
      armor: (u.armor || 0) + (bonus.armor || 0),
      aoe: Math.min(0.4, (u.aoe || 0) + (bonus.aoe || 0)),
      aoeDmg: u.aoeDmg || 0,
      boom: (u.boom || 0) + (bonus.boom || 0),
      heal: (u.heal || 0) + (bonus.heal || 0),
      healed: false,
      _dead: false,
    };
  });

  for (const unit of units) {
    if (unit.heal && !unit.healed) {
      const target = lowestHpUnit(units);
      if (target) {
        target.hp = Math.min(target.maxHp || target.hp, target.hp + unit.heal);
        unit.healed = true;
        addLog(`${unit.emoji} 치료 +${unit.heal}`);
      }
    }
  }

  return { units, counts, tagBonus };
}

function executeAttack(attacker, defenders) {
  const targetIdx = pickTarget(defenders);
  if (targetIdx < 0) return;
  const target = defenders[targetIdx];

  const crit = Math.random() < (attacker.crit || 0);
  const dmg = attacker.atk * (crit ? 2 : 1);
  applyDamage(target, dmg);
  addLog(`${attacker.emoji} -> ${target.emoji} ${crit ? "치명타" : "공격"} ${dmg}`);

  if (attacker.aoe && Math.random() < attacker.aoe) {
    for (const enemy of defenders) {
      if (enemy === target) continue;
      applyDamage(enemy, attacker.aoeDmg);
    }
    addLog(`${attacker.emoji} 광역 ${attacker.aoeDmg}`);
  }
  return { id: target.uid, crit };
}

function resolveDeaths(own, enemy) {
  let triggered = false;
  for (const unit of own) {
    if (unit.hp > 0 || unit._dead) continue;
    unit._dead = true;
    triggered = true;
    if (unit.boom) {
      for (const enemyUnit of enemy) {
        applyDamage(enemyUnit, unit.boom);
      }
      addLog(`${unit.emoji} 폭발 ${unit.boom}`);
    }
  }
  if (triggered) {
    for (let i = own.length - 1; i >= 0; i--) {
      if (own[i]._dead) own.splice(i, 1);
    }
  }
  return triggered;
}

function resolveAllDeaths(aUnits, bUnits) {
  let guard = 0;
  let changed = true;
  while (changed && guard < 10) {
    const a = resolveDeaths(aUnits, bUnits);
    const b = resolveDeaths(bUnits, aUnits);
    changed = a || b;
    guard++;
  }
}

function applyDamage(target, dmg) {
  const reduced = Math.max(1, Math.round(dmg - (target.armor || 0)));
  target.hp -= reduced;
}

function pickTarget(defenders) {
  if (!defenders.length) return -1;
  const tauntIdx = defenders.findIndex((u) => u.taunt);
  if (tauntIdx >= 0) return tauntIdx;
  return 0;
}

function lowestHpUnit(units) {
  let best = null;
  for (const u of units) {
    if (!best || u.hp < best.hp) best = u;
  }
  return best;
}

function countTags(board) {
  return board.reduce((acc, u) => {
    acc[u.tag] = (acc[u.tag] || 0) + 1;
    return acc;
  }, {});
}

function countById(board, id) {
  return board.filter((u) => u.id === id).length;
}

function buildTagBonuses(counts) {
  const result = {};
  for (const [tag, rule] of Object.entries(TAG_RULES)) {
    const count = counts[tag] || 0;
    let tier = null;
    for (const t of rule.tiers) {
      if (count >= t.count) tier = t;
    }
    if (tier) result[tag] = tier.bonus;
  }
  return result;
}

function formatSynergy(board) {
  const counts = countTags(board);
  const parts = [];
  for (const [tag, rule] of Object.entries(TAG_RULES)) {
    const count = counts[tag] || 0;
    let tier = null;
    for (const t of rule.tiers) {
      if (count >= t.count) tier = t;
    }
    if (tier) {
      parts.push(`${rule.name} ${count} (${formatBonus(tier.bonus)})`);
    }
  }
  return parts.length ? parts.join(" · ") : "시너지 없음";
}

function formatBonus(bonus) {
  const parts = [];
  if (bonus.atk) parts.push(`공+${bonus.atk}`);
  if (bonus.hp) parts.push(`체+${bonus.hp}`);
  if (bonus.armor) parts.push(`방+${bonus.armor}`);
  if (bonus.crit) parts.push(`치+${Math.round(bonus.crit * 100)}%`);
  if (bonus.boom) parts.push(`폭+${bonus.boom}`);
  if (bonus.aoe) parts.push(`광+${Math.round(bonus.aoe * 100)}%`);
  if (bonus.heal) parts.push(`치유+${bonus.heal}`);
  return parts.join(", ");
}

function shopLevelCost(level) {
  const costs = { 1: 4, 2: 6, 3: 8 };
  return costs[level] || null;
}

function maybeLevelUpShop(p, diff) {
  if (p.shopLevel >= MAX_SHOP_LEVEL) return;
  const cost = shopLevelCost(p.shopLevel);
  if (p.gold < cost) return;
  if (diff.smart) {
    if (state.round >= 3 || p.gold >= cost + 3) {
      p.gold -= cost;
      p.shopLevel += 1;
      p.shop = makeShop(p.shopLevel);
    }
  }
}

function weightedPick(level) {
  const table = {
    1: [0.8, 0.18, 0.02, 0],
    2: [0.55, 0.3, 0.12, 0.03],
    3: [0.35, 0.35, 0.2, 0.1],
    4: [0.25, 0.3, 0.25, 0.2],
  };
  const tiers = {
    1: ["warrior", "tank", "archer"],
    2: ["bomb", "mage", "healer"],
    3: ["warrior", "archer", "healer"],
    4: ["mage"],
  };
  const probs = table[level] || table[1];
  const roll = Math.random();
  let acc = 0;
  let tier = 1;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (roll <= acc) {
      tier = i + 1;
      break;
    }
  }
  const pool = tiers[tier] || tiers[1];
  const pickId = pool[Math.floor(Math.random() * pool.length)];
  return UNITS.find((u) => u.id === pickId) || UNITS[0];
}

function addLog(text) {
  logEntries.unshift({ text, id: crypto.randomUUID() });
  if (logEntries.length > 20) logEntries.pop();
}

function render() {
  if (!state) return;
  document.body.dataset.phase = state.phase;
  const seconds = state.phaseEndsAt
    ? Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))
    : 0;
  $("myHp").textContent = `내 HP: ${state.me.hp}`;
  $("myGold").textContent = `골드: ${state.me.gold}`;
  $("opHp").textContent = `상대 HP: ${state.op.hp}`;
  $("phase").textContent = `라운드 ${state.round} · ${state.phase}`;
  $("timer").textContent = state.phase === "END" ? "종료" : `남은 시간: ${seconds}s`;
  $("opName").textContent = state.settings.aiName;
  const shopCost = shopLevelCost(state.me.shopLevel);
  $("shopLevel").textContent =
    shopCost === null
      ? `상점 레벨: ${state.me.shopLevel} (MAX)`
      : `상점 레벨: ${state.me.shopLevel} (업그레이드 ${shopCost})`;

  const diffLabel = DIFFICULTY[state.settings.difficulty].label;
  $("meta").textContent = state.phase === "END" ? `SINGLE · ${diffLabel}` : `SINGLE · ${diffLabel} · ${seconds}s`;

  $("mySynergy").textContent = `내 시너지: ${formatSynergy(state.me.board)}`;
  $("opSynergy").textContent = `상대 시너지: ${formatSynergy(state.op.board)}`;

  const canShop = state.phase === "SHOP";
  $("btnReroll").disabled = !canShop || state.me.gold < 1;
  $("btnLevel").disabled =
    !canShop || state.me.shopLevel >= MAX_SHOP_LEVEL || (shopCost !== null && state.me.gold < shopCost);
  $("btnSkip").textContent =
    state.phase === "SHOP"
      ? "전투 시작"
      : state.phase === "FIGHT"
        ? fastForward
          ? "전투 가속중"
          : "전투 가속"
        : "다음 라운드";

  const showEnemy = state.phase === "FIGHT" || state.phase === "RESULT" || state.phase === "END";
  const myUnits = combatState && showEnemy ? combatState.a.units : state.me.board;
  const opUnits = combatState && showEnemy ? combatState.b.units : state.op.board;
  renderBoard("myBoard", myUnits, combatState?.lastHitA, combatState?.lastAtkA);
  renderBoard(
    "opBoard",
    showEnemy ? opUnits : state.op.board.map((u) => ({ ...u, emoji: "❓" })),
    combatState?.lastHitB,
    combatState?.lastAtkB,
  );
  renderShop(state.phase === "SHOP" ? state.me.shop : []);

  const logEl = $("log");
  logEl.innerHTML = "";
  logEntries.forEach((entry, idx) => {
    const div = document.createElement("div");
    div.className = idx === 0 ? "entry fresh" : "entry";
    div.textContent = entry.text;
    logEl.appendChild(div);
  });

  if (state.phase === "FIGHT") {
    $("msg").textContent = "전투 진행 중...";
  }

  if (state.phase === "END") {
    const winnerText = getWinnerText();
    $("msg").textContent = `게임 종료: ${winnerText}`;
  }
}

function renderBoard(elId, units, hitId, attackerId) {
  const el = $(elId);
  el.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const u = units[i];
    if (u) slot.appendChild(unitCard(u, u.uid === hitId, u.uid === attackerId));
    el.appendChild(slot);
  }
}

function renderShop(shop) {
  const el = $("shop");
  el.innerHTML = "";
  shop.forEach((u) => {
    const card = unitCard(u);
    card.style.cursor = "pointer";
    card.onclick = () => buyUnit(u.id);
    el.appendChild(card);
  });
}

function unitCard(u, isHit, isAttacker) {
  const d = document.createElement("div");
  const tagClass = u.tag ? ` tag-${u.tag}` : "";
  d.className = `unit${isHit ? " hit" : ""}${isAttacker ? " attacker" : ""}${tagClass}`;
  const maxHp = u.maxHp || u.hp || 1;
  const hpPct = Math.max(0, Math.min(100, Math.round((u.hp / maxHp) * 100)));
  d.innerHTML = `
    <div class="e">${u.emoji}</div>
    <div class="t">${TAG_EMOJI[u.tag] || ""}</div>
    <div class="s">ATK ${u.atk} • HP ${Math.max(0, Math.ceil(u.hp))}</div>
    <div class="hpbar"><span style="width:${hpPct}%"></span></div>
  `;
  return d;
}

function buyUnit(unitId) {
  if (!state || state.phase !== "SHOP") return;
  const pick = state.me.shop.find((u) => u.id === unitId);
  if (!pick) return;
  if (state.me.gold < 3) return;
  if (state.me.board.length >= 5 && countById(state.me.board, unitId) < 2) {
    $("msg").textContent = "보드가 가득 찼어요(최대 5).";
    return;
  }

  buyUnitForPlayer(state.me, unitId);
  playSound("buy");
  pulse("myGold");
  render();
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  if (soundEnabled && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  $("btnSound").textContent = soundEnabled ? "사운드: ON" : "사운드: OFF";
  playSound("toggle");
}

function playSound(type) {
  if (!soundEnabled || !audioCtx) return;
  const now = audioCtx.currentTime;
  if (type === "hit") {
    const ms = Date.now();
    if (ms - lastHitSoundAt < 120) return;
    lastHitSoundAt = ms;
  }
  const cfg = {
    toggle: { freq: 660, time: 0.08, gain: 0.04, type: "sine" },
    start: { freq: 520, time: 0.14, gain: 0.06, type: "triangle" },
    phase: { freq: 420, time: 0.08, gain: 0.04, type: "sine" },
    buy: { freq: 740, time: 0.07, gain: 0.05, type: "square" },
    hit: { freq: 220, time: 0.05, gain: 0.03, type: "square" },
    win: { freq: 880, time: 0.18, gain: 0.08, type: "triangle" },
    lose: { freq: 160, time: 0.18, gain: 0.08, type: "sawtooth" },
  }[type];
  if (!cfg) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = cfg.type;
  osc.frequency.value = cfg.freq;
  gain.gain.value = cfg.gain;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.time);
  osc.stop(now + cfg.time + 0.02);
}

function impact(boardId, isCrit) {
  const now = Date.now();
  const minGap = fastForward ? 140 : 90;
  if (now - lastImpactAt < minGap) return;
  lastImpactAt = now;

  const board = $(boardId);
  if (!board) return;
  const rect = board.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const impactEl = document.createElement("div");
  impactEl.className = "impact";
  impactEl.textContent = isCrit ? "💥" : "⚡";
  impactEl.style.left = `${Math.random() * (rect.width - 24)}px`;
  impactEl.style.top = `${Math.random() * (rect.height - 24)}px`;
  board.appendChild(impactEl);
  if (isCrit) pulse(boardId);
  setTimeout(() => impactEl.remove(), 600);
}

function pulse(elId) {
  const el = $(elId);
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
  setTimeout(() => el.classList.remove("pulse"), 300);
}

function endGame() {
  if (!state || state.phase === "END") return;
  state.phase = "END";
  state.phaseEndsAt = null;
  const outcome = getOutcome();
  updateRecord(outcome);
  render();
  endTimeoutId = setTimeout(() => {
    goToLobby();
  }, 1500);
}

function getOutcome() {
  if (state.me.hp <= 0 && state.op.hp <= 0) return "draw";
  if (state.me.hp <= 0) return "loss";
  if (state.op.hp <= 0) return "win";
  return "points";
}

function getWinnerText() {
  const outcome = getOutcome();
  if (outcome === "draw") return "무승부";
  if (outcome === "loss") return "패배";
  if (outcome === "win") return "승리";
  return "점수 종료";
}

function updateRecord(outcome) {
  const record = loadRecord();
  if (outcome === "win") record.wins += 1;
  if (outcome === "loss") record.losses += 1;
  if (outcome === "draw") record.draws += 1;
  if (outcome === "points") record.points += 1;
  saveRecord(record);
  renderRecord(record);
}

function loadRecord() {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return { wins: 0, losses: 0, draws: 0, points: 0 };
    const parsed = JSON.parse(raw);
    return {
      wins: Number(parsed.wins) || 0,
      losses: Number(parsed.losses) || 0,
      draws: Number(parsed.draws) || 0,
      points: Number(parsed.points) || 0,
    };
  } catch {
    return { wins: 0, losses: 0, draws: 0, points: 0 };
  }
}

function saveRecord(record) {
  localStorage.setItem(RECORD_KEY, JSON.stringify(record));
}

function renderRecord(record) {
  $("record").textContent = `전적: ${record.wins}승 ${record.losses}패` + (record.draws ? ` ${record.draws}무` : "");
}

function goToLobby() {
  clearTimers();
  document.body.dataset.phase = "";
  $("game").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  $("meta").textContent = "SINGLE";
  const text = getWinnerText();
  $("lobbyMsg").textContent = `직전 결과: ${text}. 다시 시작해보세요.`;
  state = null;
}

renderRecord(loadRecord());
