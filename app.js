// ===== STATE =====
const STATE = {
  screen: 'home',
  session: null,      // 現在のセッション
  timerInterval: null,
  elapsedSec: 0,
};

const CATEGORIES = ["宅建業法", "権利関係", "法令上の制限", "税・その他"];

// ===== STORAGE =====
function loadData() {
  return JSON.parse(localStorage.getItem('takken_data') || JSON.stringify({
    history: [],       // セッション履歴
    wrongIds: {},      // {id: 間違え回数}
    apiKey: '',
    dailyGoal: 20,
    streakDays: 0,
    lastStudyDate: '',
  }));
}
function saveData(d) {
  localStorage.setItem('takken_data', JSON.stringify(d));
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
}

// ===== HOME =====
function renderHome() {
  const d = loadData();
  updateStreak(d);

  // Stats
  const total = d.history.reduce((s, h) => s + h.total, 0);
  const correct = d.history.reduce((s, h) => s + h.correct, 0);
  const rate = total > 0 ? Math.round(correct / total * 100) : 0;
  const sessions = d.history.length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-rate').textContent = rate + '%';
  document.getElementById('stat-sessions').textContent = sessions;
  document.getElementById('stat-streak').textContent = d.streakDays + '日';

  // Category bars
  const catDiv = document.getElementById('cat-bars');
  catDiv.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const qs = QUESTIONS.filter(q => q.category === cat).map(q => q.id);
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
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('ja-JP');
  if (d.lastStudyDate === yesterday) {
    d.streakDays++;
  } else if (d.lastStudyDate !== today) {
    // 今日初めて開いた場合はストリークをリセットしない（学習完了時に更新）
  }
}

// ===== SESSION START =====
let selectedMode = 'random';
let selectedCat = '';
let selectedCount = 10;

function initModeSelect() {
  // モード選択（count-btn は除外）
  document.querySelectorAll('.mode-btn:not(.count-btn)').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn:not(.count-btn)').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedMode = b.dataset.mode || 'random';
      selectedCat  = b.dataset.cat  || '';
    });
  });
  // 問題数選択
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
    pool = QUESTIONS.filter(q => q.category === selectedCat);
  }

  // Shuffle & slice
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
  document.getElementById('quiz-category-tag').textContent = q.category;
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

  // Disable all options
  document.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) btn.classList.add('correct');
    else if (i === idx && !correct) btn.classList.add('wrong');
  });

  // Feedback
  const fb = document.getElementById('answer-feedback');
  fb.style.cssText = '';
  fb.style.display = 'block';
  if (correct) {
    fb.textContent = '⭕ 正解！';
    fb.className = 'correct';
  } else {
    fb.textContent = '❌ 不正解';
    fb.className = 'wrong';
  }

  // Explanation
  const exp = document.getElementById('explanation-box');
  exp.style.display = 'block';
  exp.className = correct ? 'correct-exp' : 'wrong-exp';
  document.getElementById('explanation-label').textContent = correct ? '✅ 解説' : '📖 解説（正解: ' + ['A','B','C','D'][q.ans] + '）';
  document.getElementById('explanation-text').textContent = q.exp;

  // Record
  s.answers.push({ id: q.id, correct, category: q.category });

  // Update wrong count
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

  // Save to history
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

  // Render result
  document.getElementById('result-score-num').textContent = correct;
  document.getElementById('result-score-denom').textContent = '/ ' + total;

  const pct = Math.round(correct / total * 100);
  let msg = '';
  if (pct >= 80) msg = '🎉 素晴らしい！';
  else if (pct >= 60) msg = '👍 良い調子！';
  else msg = '💪 次は挑戦！';
  document.getElementById('result-msg').textContent = msg + ' 正答率 ' + pct + '%';

  const elapsed = STATE.elapsedSec;
  const em = Math.floor(elapsed / 60), es = elapsed % 60;
  document.getElementById('result-time').textContent = `学習時間: ${em}分${es}秒`;

  // Per-category result
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

  // Wrong list
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
          <div class="wi-cat">${q.category} > ${q.sub}</div>
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
    return `【${q.category}・${q.sub}】${q.q}\n正解: ${q.opts[q.ans]}\n解説: ${q.exp}`;
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

  // Overall stats
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

  // Start btn
  document.getElementById('start-btn').addEventListener('click', startSession);

  // Next btn
  document.getElementById('next-btn').addEventListener('click', nextQuestion);

  // AI btn
  document.getElementById('ai-btn').addEventListener('click', getAIFeedback);

  // Home btn from result
  document.getElementById('result-home-btn').addEventListener('click', () => showScreen('home'));
  document.getElementById('result-retry-btn').addEventListener('click', () => {
    showScreen('home');
    setTimeout(() => showScreen('start'), 50);
  });

  // Settings
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-btn').addEventListener('click', resetAllData);
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', importData);

  showScreen('home');

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/takken-study/sw.js').catch(() => {});
  }
});
