// ===== STATE =====
const STATE = {
  screen: 'home',
  session: null,
  timerInterval: null,
  elapsedSec: 0,
  user: null,
};

const CATEGORIES = ["宅建業法", "権利関係", "法令上の制限", "税・その他"];

const DEFAULT_DATA = {
  history: [],
  wrongIds: {},
  apiKey: '',
  dailyGoal: 20,
  streakDays: 0,
  lastStudyDate: '',
  cardMastered: {},
  cardChecked: {},
};

// ===== STORAGE（localStorageをキャッシュ、Firestoreを正とする） =====
function loadData() {
  return JSON.parse(localStorage.getItem('takken_data') || JSON.stringify(DEFAULT_DATA));
}

function saveData(d) {
  localStorage.setItem('takken_data', JSON.stringify(d));
  // Firestoreにも非同期で保存
  if (STATE.user && firebase.apps.length) {
    firebase.firestore()
      .doc(`users/${STATE.user.uid}/takken/data`)
      .set(d)
      .catch(e => console.warn('Firestore保存エラー:', e));
  }
}

// ===== FIREBASE =====
function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(async user => {
      if (user) {
        STATE.user = user;
        await loadFromFirestore(user.uid);
        showAppScreen();
      } else {
        STATE.user = null;
        showLoginScreen();
      }
    });
  } catch (e) {
    console.error('Firebase初期化エラー:', e);
    showLoginScreen();
  }
}

async function loadFromFirestore(uid) {
  try {
    const snap = await firebase.firestore().doc(`users/${uid}/takken/data`).get();
    if (snap.exists) {
      const data = snap.data();
      // apiKeyはこの端末のlocalStorageを優先（セキュリティ上）
      const localApiKey = loadData().apiKey;
      if (localApiKey) data.apiKey = localApiKey;
      localStorage.setItem('takken_data', JSON.stringify(data));
    }
  } catch (e) {
    console.warn('Firestore読み込みエラー:', e);
  }
}

async function signInWithGoogle() {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
    // onAuthStateChanged が自動で次の処理を行う
  } catch (e) {
    errEl.textContent = 'ログインに失敗しました: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function signOut() {
  if (!confirm('ログアウトしますか？')) return;
  await firebase.auth().signOut();
  STATE.user = null;
}

function showLoginScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('bottom-nav').style.display = 'flex';
  document.getElementById('logout-btn').style.display = 'block';
  showScreen('home');
}

// ===== SCREEN NAVIGATION =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const nb = document.querySelector(`.nav-btn[data-screen="${id}"]`);
  if (nb) nb.classList.add('active');
  STATE.screen = id;
  if (id === 'home')     renderHome();
  if (id === 'history')  renderHistory();
  if (id === 'settings') renderSettings();
  if (id === 'cards')    renderCardsScreen();
}

// ===== FLASHCARDS =====
const CARD_CATEGORIES = [...new Set(FLASHCARDS.map(c => c.cat))];
let cardFilterCat = 'all';
let cardFilterReformOnly = false;
let cardWeakOnly = false;
let cardView = 'card';
let cardPool = [];
let cardIndex = 0;
let cardFlipped = false;

function initCardChips() {
  const chipDiv = document.getElementById('card-cat-chips');
  chipDiv.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'chip selected';
  allChip.textContent = '全科目';
  allChip.dataset.cat = 'all';
  chipDiv.appendChild(allChip);

  CARD_CATEGORIES.forEach(cat => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = cat;
    c.dataset.cat = cat;
    chipDiv.appendChild(c);
  });

  const reformChip = document.createElement('button');
  reformChip.className = 'chip reform-chip';
  reformChip.textContent = '🆕 2026年法改正のみ';
  reformChip.dataset.cat = 'reform';
  chipDiv.appendChild(reformChip);

  chipDiv.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.cat === 'reform') {
        cardFilterReformOnly = !cardFilterReformOnly;
        btn.classList.toggle('selected', cardFilterReformOnly);
      } else {
        cardFilterCat = btn.dataset.cat;
        chipDiv.querySelectorAll('.chip:not(.reform-chip)').forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
      }
      rebuildCardPool();
    });
  });
}

function rebuildCardPool() {
  let pool = [...FLASHCARDS];
  if (cardFilterCat !== 'all') pool = pool.filter(c => c.cat === cardFilterCat);
  if (cardFilterReformOnly) pool = pool.filter(c => c.reform);
  if (cardWeakOnly) {
    const d = loadData();
    pool = pool.filter(c => !d.cardMastered[c.id]);
  }
  cardPool = pool;
  cardIndex = 0;
  cardFlipped = false;
  if (cardView === 'card') renderFlashcard();
  else renderChecklist();
}

function renderCardsScreen() {
  initCardChips();
  document.querySelectorAll('#card-view-toggle .mode-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.view === cardView);
  });
  document.getElementById('card-mode-view').style.display = cardView === 'card' ? 'block' : 'none';
  document.getElementById('list-mode-view').style.display = cardView === 'list' ? 'block' : 'none';
  cardFilterCat = 'all';
  cardFilterReformOnly = false;
  cardWeakOnly = false;
  rebuildCardPool();
}

function renderFlashcard() {
  const progressEl = document.getElementById('card-progress-text');
  const flashcardEl = document.getElementById('flashcard');

  if (cardPool.length === 0) {
    progressEl.textContent = '該当するカードがありません';
    document.getElementById('fc-front-text').textContent = '条件を変更してください';
    document.getElementById('fc-front-tag').textContent = '';
    document.getElementById('fc-back-text').textContent = '';
    document.getElementById('fc-back-tag').textContent = '';
    return;
  }

  const d = loadData();
  const c = cardPool[cardIndex];
  const masteredCount = cardPool.filter(x => d.cardMastered[x.id]).length;
  progressEl.textContent = `${cardIndex + 1} / ${cardPool.length}　（このセット内 覚えた: ${masteredCount}）`;

  flashcardEl.classList.remove('flipped');
  cardFlipped = false;

  const badges = (c.reform ? ' 🆕' : '') + (c.caution ? ' ⚠️' : '') + (d.cardMastered[c.id] ? ' ✅覚えた' : '');
  document.getElementById('fc-front-tag').textContent = `${c.cat} > ${c.sub}${badges}`;
  document.getElementById('fc-front-text').textContent = c.front;
  document.getElementById('fc-back-tag').textContent = `${c.cat} > ${c.sub}${badges}`;
  document.getElementById('fc-back-text').textContent = c.back;
}

function flipCard() {
  if (cardPool.length === 0) return;
  cardFlipped = !cardFlipped;
  document.getElementById('flashcard').classList.toggle('flipped', cardFlipped);
}

function moveCard(delta) {
  if (cardPool.length === 0) return;
  cardIndex = (cardIndex + delta + cardPool.length) % cardPool.length;
  renderFlashcard();
}

function setCardMastery(mastered) {
  if (cardPool.length === 0) return;
  const c = cardPool[cardIndex];
  const d = loadData();
  if (mastered) d.cardMastered[c.id] = true;
  else delete d.cardMastered[c.id];
  saveData(d);
  moveCard(1);
}

function shuffleCards() {
  cardPool = shuffle(cardPool);
  cardIndex = 0;
  renderFlashcard();
}

function toggleWeakOnly() {
  cardWeakOnly = !cardWeakOnly;
  const btn = document.getElementById('fc-weak-only-btn');
  btn.classList.toggle('btn-accent', cardWeakOnly);
  btn.classList.toggle('btn-outline', !cardWeakOnly);
  rebuildCardPool();
}

function switchCardView(view) {
  cardView = view;
  document.querySelectorAll('#card-view-toggle .mode-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.view === view);
  });
  document.getElementById('card-mode-view').style.display = view === 'card' ? 'block' : 'none';
  document.getElementById('list-mode-view').style.display = view === 'list' ? 'block' : 'none';
  if (view === 'card') renderFlashcard();
  else renderChecklist();
}

function renderChecklist() {
  const d = loadData();
  const container = document.getElementById('checklist-container');
  container.innerHTML = '';

  const checkedCount = cardPool.filter(c => d.cardChecked[c.id]).length;
  document.getElementById('checklist-progress-text').textContent =
    `暗記済み: ${checkedCount} / ${cardPool.length}`;

  if (cardPool.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#a0aec0;padding:20px;">該当するカードがありません</p>';
    return;
  }

  cardPool.forEach(c => {
    const checked = !!d.cardChecked[c.id];
    const item = document.createElement('div');
    item.className = 'checklist-item' + (checked ? ' checked' : '');
    const badges =
      (c.reform ? '<span class="cl-badge reform">🆕改正</span>' : '') +
      (c.caution ? '<span class="cl-badge caution">⚠️要確認</span>' : '');
    item.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} data-id="${c.id}">
      <div class="cl-body">
        <div class="cl-tag">${c.cat} > ${c.sub}${badges}</div>
        <div class="cl-front">${c.front}</div>
        <div class="cl-back">${c.back}</div>
      </div>`;
    item.querySelector('input').addEventListener('change', e => {
      const dd = loadData();
      if (e.target.checked) dd.cardChecked[c.id] = true;
      else delete dd.cardChecked[c.id];
      saveData(dd);
      item.classList.toggle('checked', e.target.checked);
      document.getElementById('checklist-progress-text').textContent =
        `暗記済み: ${cardPool.filter(x => dd.cardChecked[x.id]).length} / ${cardPool.length}`;
    });
    container.appendChild(item);
  });
}

// ===== HOME =====
function renderHome() {
  const d = loadData();
  updateStreak(d);

  const total = d.history.reduce((s, h) => s + h.total, 0);
  const correct = d.history.reduce((s, h) => s + h.correct, 0);
  const rate = total > 0 ? Math.round(correct / total * 100) : 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-rate').textContent = rate + '%';
  document.getElementById('stat-sessions').textContent = d.history.length;
  document.getElementById('stat-streak').textContent = d.streakDays + '日';

  const catDiv = document.getElementById('cat-bars');
  catDiv.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const qs = QUESTIONS.filter(q => q.cat === cat).map(q => q.id);
    const catHistory = d.history.flatMap(h => h.answers || []).filter(a => qs.includes(a.id));
    const cTotal = catHistory.length;
    const cCorrect = catHistory.filter(a => a.correct).length;
    const pct = cTotal > 0 ? Math.round(cCorrect / cTotal * 100) : 0;
    const cls = pct >= 70 ? 'good' : pct >= 50 ? 'ok' : 'bad';
    catDiv.innerHTML += `
      <div class="category-bar">
        <div class="cat-label"><span>${cat}</span><span>${cTotal > 0 ? pct + '% ('+cCorrect+'/'+cTotal+')' : '未学習'}</span></div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>`;
  });

  document.getElementById('header-streak').textContent = '🔥 ' + d.streakDays + '日連続';
}

function updateStreak(d) {
  const today = new Date().toLocaleDateString('ja-JP');
  if (d.lastStudyDate === today) return;
}

// ===== SESSION START =====
let selectedMode = 'random';
let selectedCat = '';
let selectedCount = 10;

function initModeSelect() {
  document.querySelectorAll('.mode-btn:not(.count-btn)').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn:not(.count-btn)').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedMode = b.dataset.mode || 'random';
      selectedCat  = b.dataset.cat  || '';
    });
  });
  document.querySelectorAll('.count-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.count-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedCount = parseInt(b.dataset.count);
    });
  });
}

function startSession() {
  const d = loadData();
  let pool = [];

  if (selectedMode === 'random') {
    pool = [...QUESTIONS];
  } else if (selectedMode === 'weak') {
    const wrongIds = Object.entries(d.wrongIds)
      .filter(([,v]) => v > 0)
      .map(([k]) => parseInt(k));
    pool = QUESTIONS.filter(q => wrongIds.includes(q.id));
    if (pool.length === 0) {
      alert('まだ苦手問題がありません。先にランダムモードで練習しましょう！');
      return;
    }
    pool.sort((a, b) => (d.wrongIds[b.id] || 0) - (d.wrongIds[a.id] || 0));
  } else if (selectedMode === 'cat') {
    pool = QUESTIONS.filter(q => q.cat === selectedCat);
  }

  pool = shuffle(pool).slice(0, selectedCount);

  STATE.session = {
    questions: pool,
    current: 0,
    answers: [],
    startTime: Date.now(),
  };

  STATE.elapsedSec = 0;
  clearInterval(STATE.timerInterval);
  STATE.timerInterval = setInterval(() => {
    STATE.elapsedSec++;
    const m = Math.floor(STATE.elapsedSec / 60).toString().padStart(2, '0');
    const s = (STATE.elapsedSec % 60).toString().padStart(2, '0');
    const el = document.getElementById('quiz-timer');
    if (el) {
      el.textContent = m + ':' + s;
      if (STATE.elapsedSec >= 3600) el.classList.add('warn');
    }
  }, 1000);

  showScreen('quiz');
  renderQuestion();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== QUIZ =====
function renderQuestion() {
  const s = STATE.session;
  const q = s.questions[s.current];
  const total = s.questions.length;

  document.getElementById('quiz-progress-text').textContent = `${s.current + 1} / ${total}`;
  document.getElementById('quiz-progress-fill').style.width = `${(s.current / total) * 100}%`;
  document.getElementById('quiz-category-tag').textContent = q.cat;
  document.getElementById('quiz-sub-tag').textContent = q.sub;
  document.getElementById('quiz-question').textContent = q.q;

  const optsDiv = document.getElementById('quiz-options');
  optsDiv.innerHTML = '';
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = ['A', 'B', 'C', 'D'][i] + '. ' + opt;
    btn.addEventListener('click', () => selectAnswer(i));
    optsDiv.appendChild(btn);
  });

  document.getElementById('answer-feedback').style.display = 'none';
  document.getElementById('explanation-box').style.display = 'none';
  document.getElementById('next-btn').style.display = 'none';
}

function selectAnswer(idx) {
  const s = STATE.session;
  const q = s.questions[s.current];
  const correct = idx === q.ans;

  document.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === idx && !correct) btn.classList.add('wrong');
  });

  const fb = document.getElementById('answer-feedback');
  fb.style.cssText = '';
  fb.style.display = 'block';
  fb.textContent = correct ? '⭕ 正解！' : '❌ 不正解';
  fb.className = correct ? 'correct' : 'wrong';

  const exp = document.getElementById('explanation-box');
  exp.style.display = 'block';
  exp.className = correct ? 'correct-exp' : 'wrong-exp';
  document.getElementById('explanation-label').textContent = correct ? '✅ 解説' : '📖 解説（正解: ' + ['A','B','C','D'][q.ans] + '）';
  document.getElementById('explanation-text').textContent = q.exp;

  s.answers.push({ id: q.id, correct, category: q.cat });

  const d = loadData();
  if (!correct) {
    d.wrongIds[q.id] = (d.wrongIds[q.id] || 0) + 1;
  } else {
    if (d.wrongIds[q.id] > 0) d.wrongIds[q.id]--;
  }
  saveData(d);

  document.getElementById('next-btn').style.display = 'block';
}

function nextQuestion() {
  STATE.session.current++;
  if (STATE.session.current >= STATE.session.questions.length) {
    finishSession();
  } else {
    renderQuestion();
  }
}

// ===== FINISH =====
function finishSession() {
  clearInterval(STATE.timerInterval);
  const s = STATE.session;
  const correct = s.answers.filter(a => a.correct).length;
  const total = s.answers.length;

  const d = loadData();
  const today = new Date().toLocaleDateString('ja-JP');
  if (d.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('ja-JP');
    d.streakDays = d.lastStudyDate === yesterday ? d.streakDays + 1 : 1;
    d.lastStudyDate = today;
  }
  d.history.unshift({
    date: today,
    time: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    correct,
    total,
    elapsed: STATE.elapsedSec,
    answers: s.answers,
  });
  if (d.history.length > 50) d.history = d.history.slice(0, 50);
  saveData(d);

  document.getElementById('result-score-num').textContent = correct;
  document.getElementById('result-score-denom').textContent = '/ ' + total;

  const pct = Math.round(correct / total * 100);
  let msg = pct >= 80 ? '🎉 素晴らしい！' : pct >= 60 ? '👍 良い調子！' : '💪 次は挑戦！';
  document.getElementById('result-msg').textContent = msg + ' 正答率 ' + pct + '%';

  const em = Math.floor(STATE.elapsedSec / 60), es = STATE.elapsedSec % 60;
  document.getElementById('result-time').textContent = `学習時間: ${em}分${es}秒`;

  const rcDiv = document.getElementById('result-cats');
  rcDiv.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const catAns = s.answers.filter(a => a.category === cat);
    if (catAns.length === 0) return;
    const c = catAns.filter(a => a.correct).length;
    rcDiv.innerHTML += `
      <div class="result-cat">
        <div class="rcat-name">${cat}</div>
        <div class="rcat-score" style="color:${c/catAns.length>=0.7?'#27ae60':c/catAns.length>=0.5?'#f39c12':'#e74c3c'}">${c}/${catAns.length}</div>
      </div>`;
  });

  const wrongAns = s.answers.filter(a => !a.correct);
  const wDiv = document.getElementById('result-wrongs');
  wDiv.innerHTML = '';
  if (wrongAns.length === 0) {
    wDiv.innerHTML = '<p style="color:#27ae60;text-align:center;font-weight:700;">全問正解！🎉</p>';
  } else {
    wrongAns.forEach(a => {
      const q = QUESTIONS.find(q => q.id === a.id);
      if (!q) return;
      wDiv.innerHTML += `
        <div class="wrong-item">
          <div class="wi-cat">${q.cat} > ${q.sub}</div>
          <div class="wi-q">${q.q}</div>
          <div class="wi-ans">✅ 正解: ${'ABCD'[q.ans]}. ${q.opts[q.ans]}</div>
        </div>`;
    });
  }

  document.getElementById('ai-feedback-box').innerHTML = '';
  document.getElementById('ai-feedback-box').style.display = 'none';
  document.getElementById('ai-btn').style.display = wrongAns.length > 0 ? 'block' : 'none';

  showScreen('result');
}

// ===== AI FEEDBACK =====
async function getAIFeedback() {
  const d = loadData();
  if (!d.apiKey) {
    alert('設定画面でClaude APIキーを入力してください。');
    showScreen('settings');
    return;
  }

  const s = STATE.session;
  const wrongAns = s.answers.filter(a => !a.correct);
  if (wrongAns.length === 0) return;

  const wrongSummary = wrongAns.map(a => {
    const q = QUESTIONS.find(q => q.id === a.id);
    return `【${q.cat}・${q.sub}】${q.q}\n正解: ${q.opts[q.ans]}\n解説: ${q.exp}`;
  }).join('\n\n');

  const box = document.getElementById('ai-feedback-box');
  box.style.display = 'block';
  box.innerHTML = '<div class="ai-loading"><div class="spinner"></div>AIが分析中...</div>';
  document.getElementById('ai-btn').disabled = true;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': d.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `あなたは宅建（宅地建物取引士）試験の専門講師です。
受験生が以下の問題を間違えました。間違えた理由を分析し、次回正解するためのポイントを、わかりやすく・具体的に教えてください。
暗記のコツや混同しやすいポイントがあれば特に強調してください。返答は400字以内で簡潔にまとめてください。

間違えた問題：
${wrongSummary}`
        }]
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'API Error ' + res.status);
    }

    const data = await res.json();
    box.textContent = data.content[0].text;
  } catch (e) {
    box.innerHTML = `<span style="color:#e74c3c">エラーが発生しました: ${e.message}</span>`;
  } finally {
    document.getElementById('ai-btn').disabled = false;
  }
}

// ===== HISTORY =====
function renderHistory() {
  const d = loadData();
  const div = document.getElementById('history-list');

  if (d.history.length === 0) {
    div.innerHTML = '<p style="text-align:center;color:#a0aec0;padding:20px;">まだ学習履歴がありません</p>';
    return;
  }

  const totalQ = d.history.reduce((s, h) => s + h.total, 0);
  const totalC = d.history.reduce((s, h) => s + h.correct, 0);
  document.getElementById('hist-total').textContent = totalQ + '問';
  document.getElementById('hist-correct').textContent = totalC + '問';
  document.getElementById('hist-rate').textContent = totalQ > 0 ? Math.round(totalC / totalQ * 100) + '%' : '0%';

  div.innerHTML = '';
  d.history.slice(0, 20).forEach(h => {
    const pct = Math.round(h.correct / h.total * 100);
    const m = Math.floor(h.elapsed / 60), s2 = h.elapsed % 60;
    div.innerHTML += `
      <div class="history-item">
        <div>
          <div style="font-weight:600">${h.correct}/${h.total}問正解</div>
          <div class="history-date">${h.date} ${h.time} · ${m}分${s2}秒</div>
        </div>
        <div class="history-score" style="color:${pct>=70?'#27ae60':pct>=50?'#f39c12':'#e74c3c'}">${pct}%</div>
      </div>`;
  });
}

// ===== SETTINGS =====
function renderSettings() {
  const d = loadData();
  document.getElementById('api-key-input').value = d.apiKey || '';
  document.getElementById('daily-goal-input').value = d.dailyGoal || 20;
}

function saveSettings() {
  const d = loadData();
  d.apiKey = document.getElementById('api-key-input').value.trim();
  d.dailyGoal = parseInt(document.getElementById('daily-goal-input').value) || 20;
  saveData(d);
  alert('設定を保存しました。');
}

function resetAllData() {
  if (!confirm('全ての学習データをリセットしますか？この操作は取り消せません。')) return;
  localStorage.removeItem('takken_data');
  if (STATE.user && firebase.apps.length) {
    firebase.firestore().doc(`users/${STATE.user.uid}/takken/data`).delete().catch(() => {});
  }
  alert('リセットしました。');
  showScreen('home');
}

function exportData() {
  const d = loadData();
  const json = JSON.stringify(d, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'takken_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (!d.history || !d.wrongIds) throw new Error('invalid');
      saveData(d);
      alert('データを読み込みました。履歴: ' + d.history.length + '件');
      showScreen('home');
    } catch {
      alert('ファイルの形式が正しくありません。');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => showScreen(b.dataset.screen));
  });

  // Mode select
  initModeSelect();

  // Buttons
  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('next-btn').addEventListener('click', nextQuestion);
  document.getElementById('ai-btn').addEventListener('click', getAIFeedback);
  document.getElementById('result-home-btn').addEventListener('click', () => showScreen('home'));
  document.getElementById('result-retry-btn').addEventListener('click', () => {
    showScreen('home');
    setTimeout(() => showScreen('start'), 50);
  });
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-btn').addEventListener('click', resetAllData);
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', importData);

  // Login
  document.getElementById('login-btn').addEventListener('click', signInWithGoogle);
  document.getElementById('logout-btn').addEventListener('click', signOut);

  // Flashcards
  document.getElementById('flashcard').addEventListener('click', flipCard);
  document.getElementById('fc-prev-btn').addEventListener('click', () => moveCard(-1));
  document.getElementById('fc-next-btn').addEventListener('click', () => moveCard(1));
  document.getElementById('fc-mastered-btn').addEventListener('click', (e) => { e.stopPropagation(); setCardMastery(true); });
  document.getElementById('fc-notyet-btn').addEventListener('click', (e) => { e.stopPropagation(); setCardMastery(false); });
  document.getElementById('fc-shuffle-btn').addEventListener('click', shuffleCards);
  document.getElementById('fc-weak-only-btn').addEventListener('click', toggleWeakOnly);
  document.querySelectorAll('#card-view-toggle .mode-btn').forEach(b => {
    b.addEventListener('click', () => switchCardView(b.dataset.view));
  });


  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/takken-study/sw.js').catch(() => {});
  }

  // Firebase初期化
  initFirebase();
});
