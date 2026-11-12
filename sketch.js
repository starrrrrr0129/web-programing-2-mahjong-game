
const MJ_W = 70;
const MJ_H = 96;

const MJ_NUM = [
  "", "一", "二", "三", "四",
  "五", "六", "七", "八", "九"
];

const MJ_POS = {
  1: [[35, 48]],
  2: [[35, 25], [35, 70]],
  3: [[35, 20], [22, 48], [48, 76]],
  4: [[21, 27], [49, 27],
      [21, 69], [49, 69]],
  5: [[21, 24], [49, 24], [35, 48],
      [21, 72], [49, 72]],
  6: [[21, 22], [49, 22],
      [21, 48], [49, 48],
      [21, 74], [49, 74]],
  7: [[35, 13], [21, 35], [49, 35],
      [21, 57], [49, 57],
      [21, 79], [49, 79]],
  8: [[21, 14], [49, 14],
      [21, 36], [49, 36],
      [21, 60], [49, 60],
      [21, 82], [49, 82]],
  9: [[18, 18], [35, 18], [52, 18],
      [18, 48], [35, 48], [52, 48],
      [18, 78], [35, 78], [52, 78]]
};


// ========================================
// 1. 麻雀牌オブジェクト
// ========================================

class MahjongTile {

  static tiles = [];
  static beams = [];
  static reflected = [];
  static nextId = 1;

  constructor(code, x, y, options = {}) {

    // 34種類の牌を確認
    const valid =
      /^[1-9][mps]$/.test(code) ||
      ["東", "南", "西", "北",
       "白", "發", "中"].includes(code);

    if (!valid) {
      throw new Error("不明な麻雀牌: " + code);
    }

    this.id = MahjongTile.nextId++;

    this.code = code;
    this.x = x;
    this.y = y;

    this.size = options.size ?? 1;
    this.angle = options.angle ?? 0;

    // 中の標準能力
    this.firing = false;
    this.beamDirection =
      options.beamDirection ?? "up";

    // 白の標準能力
    this.guardRadius = 54 * this.size;
    this.lastReflect = -Infinity;

    // エフェクト
    this.flash = 0;

    // 命中通知
    this.onHit = null;
    this.hitTimes = new Map();

    // 衝突判定用に自動登録
    MahjongTile.tiles.push(this);
  }

  // --------------------------------
  // 座標変更
  // --------------------------------
  moveTo(x, y) {
    this.x = x;
    this.y = y;
  }

  // --------------------------------
  // 中専用：ビームのON/OFF
  // --------------------------------
  setBeam(enabled) {
    if (this.code === "中") {
      this.firing = Boolean(enabled);
    }
  }

  // --------------------------------
  // オブジェクトの削除
  // --------------------------------
  remove() {
    MahjongTile.tiles =
      MahjongTile.tiles.filter(t => t !== this);
  }

  // --------------------------------
  // 牌の描画
  // --------------------------------
  draw() {
    // 白の場合はガードも描画
    if (this.code === "白") {
      this.drawGuard();
    }

    push();
    translate(this.x, this.y);

    // 中は上向きビーム発射中に反転
    let rotation = this.angle;

    if (
      this.code === "中" &&
      this.firing &&
      this.beamDirection === "up"
    ) {
      rotation += PI;
    }

    rotate(rotation);

    mjDrawFace(this.code, this.size);

    pop();

    // 命中・反射エフェクト
    if (this.flash > 0) {
      push();
      noFill();

      stroke(
        255, 225, 120,
        this.flash * 24
      );

      strokeWeight(4);

      rectMode(CENTER);
      rect(
        this.x,
        this.y,
        MJ_W * this.size + 15,
        MJ_H * this.size + 15,
        8
      );

      pop();
    }
  }

  // --------------------------------
  // 白専用：ガード描画
  // --------------------------------
  drawGuard() {
    if (this.code !== "白") return;

    push();

    const r = this.guardRadius;

    noStroke();

    // 外側
    fill(50, 160, 255, 25);
    circle(this.x, this.y, r * 2 + 26);

    // ガード本体
    fill(70, 175, 255, 38);
    stroke(65, 175, 255);
    strokeWeight(3);

    circle(this.x, this.y, r * 2);

    // 反射時の発光
    if (this.flash > 0) {
      noFill();

      stroke(
        210, 245, 255,
        this.flash * 24
      );

      strokeWeight(7);
      circle(this.x, this.y, r * 2 + 12);
    }

    pop();
  }

  // ====================================
  // 2. 特殊能力の共通処理
  // ====================================

  // 毎フレーム1回呼ぶ
  static updateEffects() {

    const now = millis();

    MahjongTile.beams = [];

    // 発光エフェクトの更新
    for (const tile of MahjongTile.tiles) {
      if (tile.flash > 0) {
        tile.flash--;
      }
    }

    // 発射中の中を処理
    for (const tile of [...MahjongTile.tiles]) {

      if (tile.code === "中" && tile.firing) {
        MahjongTile.castBeam(tile, now);
      }
    }

    // 反射弾を移動
    MahjongTile.updateReflections(now);
  }

  // --------------------------------
  // 中ビームの当たり判定
  // --------------------------------
  static castBeam(source, now) {

    // 上向きか下向きか
    const dir =
      source.beamDirection === "down" ? 1 : -1;

    const startY =
      source.y + dir * MJ_H * source.size / 2;

    const screenEnd = dir === -1 ? 0 : height;

    let nearest =
      Math.max(0, (screenEnd - startY) * dir);

    if (nearest <= 0) return;

    let hitTarget = null;

    // 全牌から最初に当たるものを探す
    for (const target of MahjongTile.tiles) {

      if (source === target) continue;

      const dx = source.x - target.x;
      let edgeY;
      let halfH;

      // 白の場合：円形ガード
      if (target.code === "白") {

        const r = target.guardRadius;

        if (Math.abs(dx) > r) continue;

        const offset = Math.sqrt(
          Math.max(0, r * r - dx * dx)
        );

        halfH = offset;
        edgeY = target.y - dir * offset;

      } else {

        // 普通の牌：四角形
        const halfW =
          MJ_W * target.size / 2 + 5;

        if (Math.abs(dx) > halfW) continue;

        halfH = MJ_H * target.size / 2;
        edgeY = target.y - dir * halfH;
      }

      let distance = (edgeY - startY) * dir;

      // 既に当たり判定の内部にいる場合
      if (distance < 0) {
        if (
          Math.abs(startY - target.y) <= halfH
        ) {
          distance = 0;
        } else {
          continue;
        }
      }

      if (distance < nearest) {
        nearest = distance;
        hitTarget = target;
      }
    }

    const endY = startY + dir * nearest;

    // ビーム情報を保存
    MahjongTile.beams.push({
      x: source.x,
      y1: startY,
      y2: endY
    });

    if (!hitTarget) return;

    // 白に当たったら反射
    if (hitTarget.code === "白") {

      hitTarget.flash = 8;

      // 450ミリ秒ごとに反射
      if (now - hitTarget.lastReflect >= 450) {

        MahjongTile.createReflection(
          hitTarget,
          source.x,
          endY,
          dir
        );

        hitTarget.lastReflect = now;
      }

    } else {

      // 普通の牌への命中
      MahjongTile.notifyHit(
        hitTarget,
        source,
        "beam",
        now
      );
    }
  }

  // --------------------------------
  // 白：反射レーザーを生成
  // --------------------------------
  static createReflection(guard, x, y, incomingDir) {

    // 入射方向と反対へ反射
    const outDir = -incomingDir;

    // 横方向をランダム化
    const vx = random(-3.5, 3.5);

    // 避けられる程度の速度
    const vy = outDir * random(5.2, 6.6);

    MahjongTile.reflected.push({
      x: x,
      y: y + outDir * 15,
      vx: vx,
      vy: vy,
      owner: guard
    });
  }

  // --------------------------------
  // 反射レーザーの移動・衝突
  // --------------------------------
  static updateReflections(now) {

    const dt = Math.min(deltaTime / 16.67, 2);

    for (
      let i = MahjongTile.reflected.length - 1;
      i >= 0;
      i--
    ) {

      const p = MahjongTile.reflected[i];

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      let hit = false;

      for (const target of MahjongTile.tiles) {

        // 反射元は除く
        if (target === p.owner) continue;

        let collided = false;

        if (target.code === "白") {

          // ガードの円形判定
          collided =
            dist(
              p.x, p.y,
              target.x, target.y
            ) < target.guardRadius;

        } else {

          // 通常牌の四角形判定
          collided =
            Math.abs(p.x - target.x) <
              MJ_W * target.size / 2 + 5 &&
            Math.abs(p.y - target.y) <
              MJ_H * target.size / 2 + 5;
        }

        if (collided) {

          if (target.code === "白") {
            // 別の白ガードは反射弾を防御
            target.flash = 8;
          } else {
            MahjongTile.notifyHit(
              target,
              p.owner,
              "reflect",
              now
            );
          }

          hit = true;
          break;
        }
      }

      // 命中または画面外で消える
      if (
        hit ||
        p.x < -50 ||
        p.x > width + 50 ||
        p.y < -50 ||
        p.y > height + 50
      ) {
        MahjongTile.reflected.splice(i, 1);
      }
    }
  }

  // --------------------------------
  // 命中通知
  // --------------------------------
  static notifyHit(target, source, type, now) {

    const key = source.id + ":" + type;
    const last = target.hitTimes.get(key) ?? -Infinity;

    // 長押しで一瞬に大量ヒットしないよう調整
    const cooldown = type === "beam" ? 500 : 0;

    if (now - last < cooldown) return;

    target.hitTimes.set(key, now);
    target.flash = 10;

    // ゲーム側で自由に設定可能
    if (typeof target.onHit === "function") {
      target.onHit({
        target: target,
        attacker: source,
        type: type
      });
    }
  }

  // --------------------------------
  // ビームと反射弾の描画
  // --------------------------------
  static drawEffects() {

    // 中ビーム
    for (const b of MahjongTile.beams) {
      mjDrawLaser(
        b.x, b.y1,
        b.x, b.y2,
        false
      );
    }

    // 白の反射レーザー
    for (const p of MahjongTile.reflected) {

      const length = Math.hypot(p.vx, p.vy);

      const dx = p.vx / length;
      const dy = p.vy / length;

      mjDrawLaser(
        p.x - dx * 32,
        p.y - dy * 32,
        p.x + dx * 8,
        p.y + dy * 8,
        true
      );
    }
  }

  // --------------------------------
  // 全オブジェクトを初期化
  // --------------------------------
  static clear() {
    MahjongTile.tiles = [];
    MahjongTile.beams = [];
    MahjongTile.reflected = [];
    MahjongTile.nextId = 1;
  }
}


// ========================================
// 3. 立てた牌（真上から見た共通図形）
// ========================================

class StandingTile {

  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.size = options.size ?? 1;
    this.angle = options.angle ?? 0;
  }

  moveTo(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    push();

    translate(this.x, this.y);
    rotate(this.angle);
    scale(this.size);

    // 牌の背面：緑色
    noStroke();
    fill(55, 113, 91);
    rect(-35, -7, 70, 20, 4);

    // 牌の上面：白色
    stroke(195, 200, 190);
    strokeWeight(1);
    fill(251, 248, 236);
    rect(-35, -10, 70, 17, 4);

    // 上面の縁
    stroke(220, 220, 208);
    line(-30, 2, 30, 2);

    pop();
  }
}


// ========================================
// 4. レーザーの図形
// ========================================

function mjDrawLaser(x1, y1, x2, y2, reflected) {
  push();

  // 外側の光
  stroke(255, 0, 35, 70);
  strokeWeight(reflected ? 22 : 44);
  line(x1, y1, x2, y2);

  // 赤い光
  stroke(255, 40, 55, 190);
  strokeWeight(reflected ? 13 : 26);
  line(x1, y1, x2, y2);

  // 内側
  stroke(255, 140, 145);
  strokeWeight(reflected ? 7 : 13);
  line(x1, y1, x2, y2);

  // 中心
  stroke(255, 250, 245);
  strokeWeight(reflected ? 3 : 5);
  line(x1, y1, x2, y2);

  pop();
}


// ========================================
// 5. 麻雀牌の基本図形
// ========================================

function mjDrawFace(code, size) {
  push();

  scale(size);
  translate(-35, -48);

  // 牌の側面
  noStroke();
  fill(125, 175, 155);
  rect(3, 6, 70, 96, 7);

  // 牌の表面
  stroke(205, 205, 190);
  strokeWeight(1);
  fill(255, 250, 239);
  rect(0, 0, 70, 96, 7);

  const match = /^([1-9])([mps])$/.exec(code);

  if (match) {
    const n = Number(match[1]);

    if (match[2] === "m") mjMan(n);
    if (match[2] === "p") mjPin(n);
    if (match[2] === "s") mjSou(n);

  } else {
    mjHonor(code);
  }

  pop();
}


// ========================================
// 6. 萬子
// ========================================

function mjMan(n) {
  noStroke();
  textAlign(CENTER, CENTER);
  textFont("serif");
  textStyle(BOLD);

  fill(25, 50, 65);
  textSize(38);
  text(MJ_NUM[n], 35, 31);

  fill(190, 45, 55);
  textSize(33);
  text("萬", 35, 72);
}


// ========================================
// 7. 筒子
// ========================================

function mjPin(n) {

  const r =
    n === 1 ? 18 :
    n <= 3 ? 11 :
    n <= 5 ? 9 : 7;

  for (let i = 0; i < MJ_POS[n].length; i++) {

    const [x, y] = MJ_POS[n][i];

    let c;

    if (n === 1) {
      c = color(25, 120, 145);
    } else if (i % 3 === 0) {
      c = color(40, 145, 100);
    } else if (i % 3 === 1) {
      c = color(35, 105, 165);
    } else {
      c = color(190, 55, 65);
    }

    push();
    translate(x, y);

    stroke(c);
    strokeWeight(2);
    fill(255);
    circle(0, 0, r * 2);

    noStroke();

    fill(c);
    circle(0, 0, r * 1.5);

    fill(255, 245, 220);
    circle(0, 0, r * 0.8);

    fill(c);
    circle(0, 0, r * 0.35);

    pop();
  }
}


// ========================================
// 8. 索子
// ========================================

function mjSou(n) {
  if (n === 1) {
    mjBird();
    return;
  }

  const w = n <= 3 ? 12 : n <= 6 ? 9 : 7;

  for (const [x, y] of MJ_POS[n]) {
    push();
    translate(x, y);

    noStroke();

    // 竹
    fill(25, 120, 75);
    rect(-w / 2, -11, w, 22, 3);

    // 明るい面
    fill(75, 180, 115);
    rect(-w / 4, -10, w / 2, 20, 2);

    // 節
    fill(210, 235, 160);
    rect(-w / 2, -4, w, 3);
    rect(-w / 2, 4, w, 3);

    pop();
  }
}


// ========================================
// 9. 一索の鳥
// ========================================

function mjBird() {
  push();
  noStroke();

  // 尾羽
  for (let i = -2; i <= 2; i++) {
    fill(i % 2 === 0
      ? color(30, 135, 135)
      : color(45, 100, 165));

    ellipse(35 + i * 9, 48, 10, 40);
  }

  // 体
  fill(30, 110, 135);
  ellipse(35, 59, 25, 35);

  // 翼
  fill(65, 180, 140);
  ellipse(30, 62, 12, 22);

  // 首と頭
  fill(30, 120, 140);
  rect(32, 38, 8, 16, 3);
  ellipse(35, 35, 18, 18);

  // 目
  fill(255);
  circle(40, 33, 6);

  fill(20);
  circle(40, 33, 3);

  // くちばし
  fill(225, 155, 55);
  triangle(43, 36, 55, 39, 43, 42);

  // 足
  stroke(145, 90, 50);
  strokeWeight(2);
  line(31, 75, 29, 86);
  line(40, 75, 43, 86);

  pop();
}


// ========================================
// 10. 字牌
// ========================================

function mjHonor(ch) {

  // 白
  if (ch === "白") {
    noFill();

    stroke(40, 120, 175);
    strokeWeight(4);
    rect(12, 18, 46, 60, 3);

    stroke(175, 210, 230);
    strokeWeight(1);
    rect(18, 24, 34, 48, 2);

    return;
  }

  noStroke();
  textAlign(CENTER, CENTER);
  textFont("serif");
  textStyle(BOLD);
  textSize(48);

  if (ch === "發") {
    fill(25, 135, 75);

  } else if (ch === "中") {
    fill(200, 40, 50);

  } else {
    fill(25, 45, 60);
  }

  text(ch, 35, 48);
}

//_____________________


let standing = [];
let chu, enemy;
let guards = [];
let flying = [];
let reflected = [];

let started = false;
let shooting = false;

let startTime = 0;
let lastSpawn = 0;

let hits = 0;
let hp = 5;
let canHit = true;
let invincibleUntil = 0;

let result = "";
let effectStart = 0;
let winBeamX = 200;
let winBeamY = 0;

let stageW = 400;
let stageH = 650;

// 対面：国士無双の白単騎待ち
let enemyHand = [
  "1m", "1m", "9m",
  "1p", "9p", "1s", "9s",
  "東", "南", "西", "北", "中", "發"
];

// 自分：東待ち・三色同順
let myHand = [
  "2m", "3m", "4m",
    "1p", "2p", "3p",
  "6p", "7p", "8p",
  "2s", "3s", "4s",
  "東"
];

let tileTypes = [];


// ==================================
// setup
// ==================================
function setup() {
  createCanvas(stageW, stageH);
  MahjongTile.clear();

  // 飛来牌の種類
  for (let i = 1; i <= 9; i++) {
    tileTypes.push(i + "m");
    tileTypes.push(i + "p");
    tileTypes.push(i + "s");
  }

  tileTypes.push("東", "南", "西", "北", "發");

  // 最初の4方向の牌
  for (let i = 0; i < 13; i++) {
    let x = 20 + i * 30;
    let y = 145 + i * 29;

    standing.push(
      new StandingTile(x, 65, {size: 0.4})
    );

    standing.push(
      new StandingTile(x, 585, {size: 0.4})
    );

    standing.push(
      new StandingTile(30, y, {
        size: 0.3,
        angle: HALF_PI
      })
    );

    standing.push(
      new StandingTile(370, y, {
        size: 0.3,
        angle: HALF_PI
      })
    );
  }

  // プレイヤーの中
  chu = new MahjongTile("中", 200, 570, {
    size: 0.7
  });

  // 対面の東
  enemy = new MahjongTile("東", 200, 85, {
    size: 0.7,
    angle: PI
  });

  // 最初の白ガード
  let haku = new MahjongTile("白", 200, 280, {
    size: 0.7
  });

  // 白ごとの反射時刻
  haku.lastReflect = 0;
  guards.push(haku);

  // ビームはsketch.jsで管理
  chu.setBeam(false);
}


// ==================================
// クリックでゲーム開始・発射
// ==================================
function mousePressed() {

  if (!started) {
    started = true;
    startTime = millis();
    lastSpawn = millis();
    return false;
  }

  let time = (millis() - startTime) / 1000;

  if (time >= 10 && result === "") {
    shooting = true;
  }

  return false;
}


// ==================================
// クリックを離したとき
// ==================================
function mouseReleased() {
  shooting = false;
  canHit = true;
  return false;
}


// ==================================
// draw
// ==================================
function draw() {
  background(30, 90, 65);

  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);

  // ==================================
  // タイトル
  // ==================================
  if (!started) {
    textSize(32);
    text("麻雀ゲーム", 200, 260);

    textSize(18);
    text("クリックで対局開始", 200, 350);

    textSize(13);
    text("中ビームで対面を撃破し勝利しよう！", 200, 410);
    return;
  }

  let time = (millis() - startTime) / 1000;

  // ==================================
  // 最初の5秒
  // ==================================
  if (time < 5) {

    for (let tile of standing) {
      tile.draw();
    }

    textSize(24);
    text("対局開始", 200, 325);
    return;
  }

  // ==================================
  // 5〜10秒：手牌公開
  // ==================================
  if (time < 10) {

    textSize(16);
    text("対面：国士無双聴牌（白待ち）", 200, 90);

    drawHand(enemyHand, 170);

    text("自分の手牌", 200, 465);
    drawHand(myHand, 540);
    return;
  }

  // ==================================
  // 勝敗演出
  // ==================================
  if (result === "winEffect") {
    drawWinEffect();
    return;
  }

  if (result === "loseEffect" || result === "lose") {
    drawLoseEffect();
    return;
  }

  if (result === "win") {
    drawWinResult();
    return;
  }

  // ==================================
  // 戦闘開始
  // ==================================
  let battleTime = time - 10;

  // 60秒経過で敗北
  if (battleTime >= 60) {
    loseGame();
    drawLoseEffect();
    return;
  }

  // ----------------------------------
  // 中の移動
  // ----------------------------------
  chu.x = constrain(mouseX, 25, 375);
  chu.y = constrain(mouseY, 545, 595);

  // マウス長押し、またはスペースキー
  let firing =
    shooting ||
    mouseIsPressed ||
    keyIsDown(32);

  // 攻撃をやめたら次の命中が可能
  if (!firing) {
    canHit = true;
  }

  // ----------------------------------
  // 白ガードの移動
  // ----------------------------------
  for (let i = 0; i < guards.length; i++) {

    guards[i].x =
      200 +
      sin(battleTime * (1.5 + i * 0.3) + i * 2)
      * 110;

    guards[i].y = 280 - i * 25;
  }

  // ----------------------------------
  // 中ビームの範囲
  // ----------------------------------
  let beam = getChuBeam(firing);

  // ----------------------------------
  // 対面への命中判定
  // ----------------------------------
  if (
    beam !== null &&
    beam.guard === null &&
    abs(beam.x - enemy.x) < 28 &&
    canHit
  ) {

    hits++;
    canHit = false;

    // 4回命中で撃破
    if (hits >= 4) {
      result = "winEffect";
      effectStart = millis();

      winBeamX = beam.x;
      winBeamY = beam.bottom;

      shooting = false;
      drawWinEffect();
      return;
    }

    // 白ガード追加（最大3枚）
    else if (guards.length < 3) {

      let haku = new MahjongTile("白", 200, 280, {
        size: 0.7
      });

      // 新しい白も独立して反射
      haku.lastReflect = 0;

      guards.push(haku);
    }
  }

  // ==================================
  // 白ガードのランダム反射ビーム
  // 800ms → 400ms
  // ==================================
  if (
    beam !== null &&
    beam.guard !== null
  ) {

    let haku = beam.guard;

    // この白が最後に反射してから
    // 400ms経過していれば発射
    if (
      millis() - haku.lastReflect > 400
    ) {

      let x = beam.x;
      let y = beam.top;

      // 下向きのランダム角度
      let angle =
        random(radians(55), radians(125));

      let speed = random(6.0, 7.5);

      reflected.push({
        x: x,
        y: y,
        vx: cos(angle) * speed,
        vy: sin(angle) * speed
      });

      // この白の反射時刻を更新
      haku.lastReflect = millis();
    }
  }

  // ==================================
  // 飛来牌の生成
  // 350ms → 230ms
  // ==================================
  if (millis() - lastSpawn > 230) {

    let x = random(35, 365);

    flying.push({
      code: random(tileTypes),
      x: x,
      y: -30,
      centerX: x,

      // 以前より速く落下
      speed: random(2.2, 3.6),

      wave: random(0.04, 0.1),
      amplitude: random(20, 65),
      phase: random(TWO_PI),
      age: 0
    });

    lastSpawn = millis();
  }

  // ==================================
  // 飛来牌の移動
  // ==================================
  for (let i = flying.length - 1; i >= 0; i--) {

    let b = flying[i];
    b.age++;

    // 下に移動
    b.y += b.speed;

    // 波打つ動き
    b.x =
      b.centerX +
      sin(b.age * b.wave + b.phase) *
      b.amplitude +
      cos(b.age * 0.025 + b.phase * 2) * 20;

    // ----------------------------------
    // 中ビームで飛来牌を破壊
    // ----------------------------------
    if (
      beam !== null &&
      abs(b.x - beam.x) < 24 &&
      b.y + 18 > beam.top &&
      b.y - 18 < beam.bottom
    ) {
      flying.splice(i, 1);
      continue;
    }

    // ----------------------------------
    // 中との衝突
    // ----------------------------------
    if (
      abs(b.x - chu.x) < 32 &&
      abs(b.y - chu.y) < 43
    ) {

      damagePlayer();
      flying.splice(i, 1);
      continue;
    }

    // 画面外で削除
    if (b.y > stageH + 35) {
      flying.splice(i, 1);
    }
  }

  // ==================================
  // 反射ビームの移動
  // ==================================
  for (let i = reflected.length - 1; i >= 0; i--) {

    let b = reflected[i];

    b.x += b.vx;
    b.y += b.vy;

    // 中に命中
    if (
      abs(b.x - chu.x) < 24 &&
      abs(b.y - chu.y) < 32
    ) {

      damagePlayer();
      reflected.splice(i, 1);
      continue;
    }

    // 画面外で削除
    if (
      b.y > stageH + 20 ||
      b.y < -20 ||
      b.x < -20 ||
      b.x > stageW + 20
    ) {
      reflected.splice(i, 1);
    }
  }

  if (result === "loseEffect") {
    drawLoseEffect();
    return;
  }

  // ==================================
  // 画面描画
  // ==================================

  // 対面の東
  enemy.draw();

  // 対面の13枚は反対向き
  drawHand(enemyHand, 180, true);

  // 白ガード
  for (let haku of guards) {
    haku.draw();
  }

  // 飛来牌
  for (let b of flying) {
    push();

    translate(b.x, b.y);

    rotate(
      sin(b.age * 0.07 + b.phase) * 0.5
    );

    mjDrawFace(b.code, 0.45);

    pop();
  }

  // 赤いランダム反射ビーム
  for (let b of reflected) {
    drawReflectedBeam(b);
  }

  // ----------------------------------
  // 中：発射中は180度回転
  // ----------------------------------
  if (
    millis() >= invincibleUntil ||
    frameCount % 10 < 5
  ) {

    if (firing) {
      push();

      translate(chu.x, chu.y);
      rotate(PI);

      mjDrawFace("中", chu.size);

      pop();
    }

    else {
      chu.draw();
    }
  }

  // ----------------------------------
  // 中ビームを最前面に描画
  // ----------------------------------
  if (beam !== null) {

    drawVisibleBeam(
      beam.x,
      beam.bottom,
      beam.top
    );
  }

  // ----------------------------------
  // ステータス
  // ----------------------------------
  push();

  fill(255);
  noStroke();
  textFont("sans-serif");
  textAlign(CENTER, CENTER);

  textSize(14);
  text("残り " + ceil(60 - battleTime) + "秒", 65, 25);
  text("命中 " + hits + "/4", 335, 25);

  textSize(16);
  text("HP: " + hp, 50, 55);

  textSize(12);
  text("対面", 200, 140);
  text("長押し：中ビーム", 200, 635);

  pop();
}


// ==================================
// ダメージ処理
// ==================================
function damagePlayer() {

  if (millis() < invincibleUntil) {
    return;
  }

  hp--;
  invincibleUntil = millis() + 1000;

  if (hp <= 0) {
    loseGame();
  }
}


// ==================================
// 敗北処理
// ==================================
function loseGame() {

  if (result !== "") return;

  result = "loseEffect";
  effectStart = millis();
  shooting = false;
}


// ==================================
// 通常の手牌描画
// ==================================
function drawHand(hand, y, reverse = false) {

  let gap = 28;
  let startX =
    200 - (hand.length - 1) * gap / 2;

  for (let i = 0; i < hand.length; i++) {

    push();

    translate(startX + i * gap, y);

    if (reverse) {
      rotate(PI);
    }

    mjDrawFace(hand[i], 0.35);

    pop();
  }
}


// ==================================
// 勝利時の14枚の位置
// ==================================
function getWinningHandLayout() {

  let gap = 26;

  // 14枚を中央寄せ
  let startX = 200 - 13 * gap / 2;

  // 最後の東の位置
  let lastX = startX + 13 * gap;

  return {
    gap: gap,
    startX: startX,
    lastX: lastX
  };
}


// ==================================
// 勝利時の自分の手牌
// ==================================
function drawWinningHand(y, addEast) {

  let layout = getWinningHandLayout();

  // 元の13枚
  for (let i = 0; i < 13; i++) {

    push();

    translate(
      layout.startX + i * layout.gap,
      y
    );

    mjDrawFace(myHand[i], 0.35);

    pop();
  }

  // 14枚目の東
  if (addEast) {

    let x = layout.lastX;

    let glow =
      80 + 50 * sin(millis() * 0.008);

    push();

    noStroke();
    rectMode(CENTER);

    fill(255, 220, 75, glow);
    rect(x, y, 27, 43, 5);

    translate(x, y);

    mjDrawFace("東", 0.35);

    pop();
  }
}


// ==================================
// 中ビームの範囲を計算
// ==================================
function getChuBeam(firing) {

  if (!firing || result !== "") {
    return null;
  }

  // 中の上端から発射
  let startY =
    chu.y - 96 * chu.size / 2;

  let endY = 0;
  let hitGuard = null;

  // 対面の東に当たる場合
  if (abs(chu.x - enemy.x) < 28) {
    endY =
      enemy.y + 48 * enemy.size;
  }

  // 白ガードとの衝突
  for (let haku of guards) {

    let dx = chu.x - haku.x;
    let r = 54 * haku.size;

    if (abs(dx) < r) {

      let hitY =
        haku.y +
        sqrt(r * r - dx * dx);

      if (
        hitY < startY &&
        hitY > endY
      ) {
        endY = hitY;
        hitGuard = haku;
      }
    }
  }

  if (startY <= endY) {
    return null;
  }

  return {
    x: chu.x,
    top: endY,
    bottom: startY,
    guard: hitGuard
  };
}


// ==================================
// 中ビームの描画
// ==================================
function drawVisibleBeam(x, bottom, top) {

  if (bottom <= top) return;

  push();

  stroke(255, 0, 0, 70);
  strokeWeight(38);
  line(x, bottom, x, top);

  stroke(255, 40, 40, 230);
  strokeWeight(22);
  line(x, bottom, x, top);

  stroke(255, 150, 150);
  strokeWeight(11);
  line(x, bottom, x, top);

  stroke(255);
  strokeWeight(5);
  line(x, bottom, x, top);

  pop();
}


// ==================================
// 白が反射する赤いビーム
// ==================================
function drawReflectedBeam(b) {

  push();

  let tailX = b.x - b.vx * 10;
  let tailY = b.y - b.vy * 10;

  // 外側の赤い光
  stroke(255, 0, 0, 70);
  strokeWeight(26);

  line(tailX, tailY, b.x, b.y);

  // 中間の赤い光
  stroke(255, 40, 40, 230);
  strokeWeight(15);

  line(tailX, tailY, b.x, b.y);

  // 明るい赤
  stroke(255, 150, 150);
  strokeWeight(8);

  line(tailX, tailY, b.x, b.y);

  // 白い中心
  stroke(255);
  strokeWeight(3);

  line(tailX, tailY, b.x, b.y);

  pop();
}


// ==================================
// 勝利演出
// ビーム → 爆発 → 東を略奪 → ロン
// ==================================

//
// 勝利演出
// ビーム → 爆発 → 東を略奪
// → パチンコ風の大当たり演出 → 勝利
//
function drawWinEffect() {

  let t = millis() - effectStart;
  let layout = getWinningHandLayout();

  // 対面の13枚
  drawHand(enemyHand, 180, true);

  // 中は対面を向いたまま
  push();
  translate(chu.x, chu.y);
  rotate(PI);
  mjDrawFace("中", chu.size);
  pop();

  // ==================================
  // ① 0〜2.5秒：ビーム照射
  // ==================================
  if (t < 2500) {

    drawVisibleBeam(
      winBeamX,
      winBeamY,
      enemy.y + 48 * enemy.size
    );

    // 東が震える
    let shake =
      sin(millis() * 0.15) *
      (t / 2500) * 8;

    push();

    translate(enemy.x + shake, enemy.y);
    rotate(PI);

    scale(1 - (t / 2500) * 0.25);
    mjDrawFace("東", 0.7);

    pop();
  }

  // ==================================
  // ② 2.5〜3.2秒：爆発
  // ==================================
  else if (t < 3200) {

    let explosion = (t - 2500) / 700;

    push();
    noStroke();

    // 赤い爆発
    fill(255, 70, 30, 210 * (1 - explosion));
    circle(
      enemy.x,
      enemy.y,
      50 + explosion * 150
    );

    // 黄色い光
    fill(255, 215, 90, 230 * (1 - explosion));
    circle(
      enemy.x,
      enemy.y,
      35 + explosion * 95
    );

    // 白い閃光
    fill(255, 255, 255, 255 * (1 - explosion));
    circle(
      enemy.x,
      enemy.y,
      20 + explosion * 60
    );

    // 爆発の輪
    noFill();

    stroke(
      255, 190, 75,
      255 * (1 - explosion)
    );

    strokeWeight(7);

    circle(
      enemy.x,
      enemy.y,
      25 + explosion * 230
    );

    // 飛び散る破片
    for (let i = 0; i < 28; i++) {

      let angle = TWO_PI * i / 28;

      let distance =
        15 + explosion * (75 + (i % 4) * 15);

      let x =
        enemy.x + cos(angle) * distance;

      let y =
        enemy.y + sin(angle) * distance;

      stroke(
        255,
        130 + (i % 3) * 45,
        40,
        255 * (1 - explosion)
      );

      strokeWeight(3 + i % 3);

      line(
        x - cos(angle) * 13,
        y - sin(angle) * 13,
        x,
        y
      );
    }

    pop();

    fill(255, 225, 95);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(30);

    text("撃破！", 200, 365);
  }

  // ==================================
  // ③ 3.2秒〜：自分の手牌が現れる
  // ==================================
  if (t >= 3200) {

    // ==================================
    // ④ 3.2〜4.4秒：東が飛んでくる
    // ==================================
    if (t < 4400) {

      drawWinningHand(455, false);

      let p = (t - 3200) / 1200;

      p = constrain(p, 0, 1);

      // なめらかな移動
      p = p * p * (3 - 2 * p);

      let x =
        lerp(enemy.x, layout.lastX, p);

      let y =
        lerp(enemy.y, 455, p);

      push();

      translate(x, y);

      rotate(PI * (1 - p));

      mjDrawFace(
        "東",
        0.35 + 0.25 * (1 - p)
      );

      pop();
    }

    // ==================================
    // ⑤ 4.4秒〜：大当たり演出
    // ==================================
    else {

      // 14枚の完成形
      drawWinningHand(455, true);

      // 金色と虹色の演出
      if (t < 7000) {

        drawJackpotFlash(t);

      } else {

        // 演出後に勝利を表示
        fill(255, 225, 95);
        noStroke();
        textAlign(CENTER, CENTER);

        textSize(25);
        text("対面を中ビームで撃破！", 200, 260);

        textSize(30);
        text("東を略奪！", 200, 315);

        textSize(38);
        text("勝利！", 200, 370);

        textSize(20);
        text("役　撃破　一翻", 200, 525);

        textSize(17);
        text("略奪　二翻", 200, 560);
      }
    }
  }

  // 9秒で通常の勝利画面へ
  if (t >= 9000) {
    result = "win";
  }
}


// ==================================
// パチンコ風の大当たり演出
// ==================================
function drawJackpotFlash(t) {

  let elapsed = t - 4400;
  let progress = elapsed / 2600;

  push();

  // ==================================
  // 金色と赤色の画面点滅
  // ==================================
  rectMode(CORNER);
  noStroke();

  if (floor(elapsed / 300) % 2 === 0) {
    fill(255, 215, 35, 110);
  } else {
    fill(255, 100, 40, 45);
  }

  rect(0, 0, width, height);

  // ==================================
  // 放射状に回転する金色の光
  // ==================================
  translate(width / 2, height / 2);

  for (let i = 0; i < 24; i++) {

    let angle =
      TWO_PI * i / 24 + progress * 5;

    stroke(255, 225, 65, 110);
    strokeWeight(3 + i % 3);

    line(
      cos(angle) * 65,
      sin(angle) * 65,
      cos(angle) * 390,
      sin(angle) * 480
    );
  }

  // ==================================
  // 中央から広がる光の輪
  // ==================================
  noFill();

  for (let i = 0; i < 3; i++) {

    let r =
      (elapsed * 0.32 + i * 210) % 650;

    stroke(
      255, 245, 145,
      170 * (1 - r / 650)
    );

    strokeWeight(8);
    circle(0, 0, r);
  }

  // ==================================
  // 虹色のキラキラ
  // ==================================
  noStroke();

  for (let i = 0; i < 75; i++) {

    let angle =
      i * 2.4 + progress * 6;

    let r =
      (i * 41 +
      elapsed * (0.08 + i % 4 * 0.02)) % 430;

    let x = cos(angle) * r;
    let y = sin(angle) * r * 1.2;

    if (i % 3 === 0) {
      fill(255, 240, 105, 230);
    } else if (i % 3 === 1) {
      fill(105, 240, 255, 210);
    } else {
      fill(255, 110, 220, 220);
    }

    let s = 4 + i % 5 * 2;

    circle(x, y, s);
  }

  pop();
}

// ==================================
// 勝利結果画面
// ==================================
function drawWinResult() {

  // 対面の13枚
  drawHand(enemyHand, 180, true);

  // 自分の和了した14枚
  drawWinningHand(455, true);

  fill(255, 225, 95);
  noStroke();
  textAlign(CENTER, CENTER);

  // セリフの位置を統一
  textSize(25);
  text("対面を中ビームで撃破！", 200, 260);

  textSize(30);
  text("東を略奪！", 200, 315);

  textSize(38);
  text("勝利！", 200, 370);

  // ゲームオリジナルの役
  textSize(20);
  text("役　撃破　一翻", 200, 525);

  // 実際に成立する役
  textSize(17);
  text("略奪　二翻", 200, 560);
}


// ==================================
// 敗北演出
// 白が国士無双の14枚目になる
// ==================================
function drawLoseEffect() {

  let t = millis() - effectStart;

  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);

  textSize(21);
  text(
    "対面の国士無双が完成してしまった",
    200, 185
  );

  // 対面の13枚
  for (let i = 0; i < 13; i++) {

    push();

    translate(18 + i * 28, 290);

    mjDrawFace(enemyHand[i], 0.35);

    pop();
  }

  // ----------------------------------
  // 14枚目の白が徐々に現れて点滅
  // ----------------------------------
  let fade =
    constrain(t / 3000, 0, 1);

  let blink =
    0.3 +
    0.4 *
    (0.5 + 0.5 * sin(millis() * 0.015));

  let alpha = fade * blink;

  push();

  drawingContext.globalAlpha = alpha;

  translate(18 + 13 * 28, 290);

  mjDrawFace("白", 0.35);

  pop();

  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);

  // 白が現れてからロン
  if (t >= 1500) {
    textSize(28);
    text("国士無双 ロン", 200, 405);
  }

  // さらに遅れて敗北表示
  if (t >= 2500) {
    textSize(30);
    text("敗北　-48000点", 200, 480);
  }

  // 4.5秒で演出終了
  if (t >= 4500) {
    result = "lose";
  }
}





