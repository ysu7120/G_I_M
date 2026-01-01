// Globals
let currentSet = {};
let currentPhase = "";
let timerInterval;
let ws;
let audioContext;
let currentActiveQIndex = -1; // -1: none
let sessionStartTime;
let sessionLog = { planning: [], immediate: [], answers: {} };

// --- Navigation ---
function goHome() {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('home-view').classList.add('active');
    stopAudio();
}

function showSimStartData() {
    document.getElementById('modal-start').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// --- Simulation: Start ---
async function startSimulationReal() {
    closeModal('modal-start');

    // 1. Fetch Data
    const res = await fetch('/api/simulation/random_set');
    currentSet = await res.json();

    // 2. Setup Planning UI
    const planList = document.getElementById('planning-qs-list');
    planList.innerHTML = "";
    currentSet.planning.forEach((q, idx) => {
        planList.innerHTML += `
            <div class="question-card">
                <strong>구상 ${idx + 1}.</strong><br>
                ${q.content}
            </div>
        `;
    });

    // 3. Switch View
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('simulation-view').classList.add('active');

    document.querySelectorAll('.phase-container').forEach(el => el.classList.remove('active'));
    document.getElementById('sim-planning').classList.add('active');

    // 4. Timer
    startTimer(15 * 60);
    sessionStartTime = new Date();
}

// --- Timer ---
function startTimer(seconds) {
    clearInterval(timerInterval);
    const display = document.getElementById('planning-timer');
    let remain = seconds;

    timerInterval = setInterval(() => {
        remain--;
        const m = Math.floor(remain / 60);
        const s = remain % 60;
        display.innerText = `${m}:${s < 10 ? '0' + s : s}`;

        if (remain <= 0) {
            clearInterval(timerInterval);
            finishPlanning();
        }
    }, 1000);
}

function finishPlanning() {
    clearInterval(timerInterval);
    document.getElementById('modal-plan-finish').style.display = 'flex';
}

// --- Interview: Planning Phase ---
async function startInterviewReal() {
    closeModal('modal-plan-finish');
    document.getElementById('sim-planning').classList.remove('active');
    document.getElementById('sim-interview-planning').classList.add('active');

    // Connect Audio
    await initAudio();

    // Render UI
    const list = document.getElementById('interview-planning-list');
    list.innerHTML = "";
    currentSet.planning.forEach((q, idx) => {
        list.innerHTML += `
            <div class="question-card" id="plan-card-${idx}">
                <p><strong>문제 ${idx + 1}</strong>: ${q.content}</p>
                <div class="transcript-area" id="ans-plan-${idx}">대기 중...</div>
                <button class="btn-large" style="margin-top:10px; font-size:0.9rem; padding:10px;" 
                    id="btn-plan-done-${idx}" onclick="donePlanningQ(${idx})">
                    답변 완료
                </button>
            </div>
        `;
    });

    // Activate First
    activateQ(0, 'plan');
}

function activateQ(idx, type) {
    // Disable all buttons first (logic enforcement)
    // Only enable current
    const prefix = type === 'plan' ? 'btn-plan-done-' : 'btn-imm-done-';

    // Highlight
    currentActiveQIndex = idx;

    // Visual cue
    const cardId = type === 'plan' ? `plan-card-${idx}` : `imm-card-${idx}`;
    document.getElementById(cardId).style.border = "2px solid var(--duo-blue)";
    document.getElementById(cardId).style.background = "#effaff";

    // Update STT destination
    window.currentTranscriptTarget = type === 'plan' ? `ans-plan-${idx}` : `ans-imm-${idx}`;
    document.getElementById(window.currentTranscriptTarget).innerText = "(답변을 편하게 말씀하세요)";
}

function donePlanningQ(idx) {
    // Save Log
    const target = document.getElementById(`ans-plan-${idx}`);
    sessionLog.answers[`plan_${idx}`] = target.innerText;

    // Disable button
    document.getElementById(`btn-plan-done-${idx}`).classList.add('disabled');
    document.getElementById(`btn-plan-done-${idx}`).disabled = true;

    // Next?
    if (idx < 2) {
        activateQ(idx + 1, 'plan');
    } else {
        // Unlock Immediate Button
        document.getElementById('btn-start-immediate').classList.remove('disabled');
        currentActiveQIndex = -1; // No target
    }
}

function startImmediatePhase() {
    document.getElementById('sim-interview-planning').classList.remove('active');
    document.getElementById('sim-interview-immediate').classList.add('active');

    const list = document.getElementById('interview-immediate-list');
    list.innerHTML = "";

    currentSet.immediate.forEach((q, idx) => {
        list.innerHTML += `
            <div class="question-card" id="imm-card-${idx}" style="opacity:0.5">
                <p><strong>즉답형 ${idx + 1}</strong> <span id="imm-q-text-${idx}">(문제 낭독 대기)</span></p>
                <div class="transcript-area" id="ans-imm-${idx}"></div>
                <button class="btn-large disabled" style="margin-top:10px; font-size:0.9rem; padding:10px;" 
                    id="btn-imm-done-${idx}" onclick="doneImmQ(${idx})">
                    답변 완료
                </button>
            </div>
        `;
    });

    // Speak Q1
    playTTS(currentSet.immediate[0].content, () => {
        // Unlock Q1
        document.getElementById('imm-card-0').style.opacity = 1;
        document.getElementById('imm-q-text-0').innerText = currentSet.immediate[0].content;
        document.getElementById('btn-imm-done-0').classList.remove('disabled');
        activateQ(0, 'imm');
    });
}

function doneImmQ(idx) {
    const target = document.getElementById(`ans-imm-${idx}`);
    sessionLog.answers[`imm_${idx}`] = target.innerText;
    document.getElementById(`btn-imm-done-${idx}`).classList.add('disabled');

    if (idx < 1) {
        // Speak Q2
        playTTS(currentSet.immediate[1].content, () => {
            document.getElementById('imm-card-1').style.opacity = 1;
            document.getElementById('imm-q-text-1').innerText = currentSet.immediate[1].content;
            document.getElementById('btn-imm-done-1').classList.remove('disabled');
            activateQ(1, 'imm');
        });
    } else {
        // Finish
        document.getElementById('btn-finish-all').classList.remove('disabled');
        currentActiveQIndex = -1;
    }
}

function finishAll() {
    stopAudio();
    document.getElementById('modal-all-finish').style.display = 'flex';
}

async function saveAndGoHistory() {
    closeModal('modal-all-finish');

    // Prepare Data
    sessionLog.planning = currentSet.planning;
    sessionLog.immediate = currentSet.immediate;

    const duration = Math.floor((new Date() - sessionStartTime) / 1000);

    await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            duration: duration,
            details: sessionLog
        })
    });

    // Reset
    sessionLog = { planning: [], immediate: [], answers: {} };
    showHistory();
}

// --- History & Questions ---
async function showHistory() {
    goHome();
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('history-view').classList.add('active');

    const res = await fetch('/api/history');
    const logs = await res.json();
    const list = document.getElementById('history-list');
    list.innerHTML = "";

    if (logs.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#888;">
                <div style="font-size:3rem; margin-bottom:10px;">📝</div>
                <h3>아직 연습 기록이 없어요!</h3>
                <p>지금 바로 면접 연습을 시작해보세요.</p>
                <button onclick="goHome()" class="menu-btn primary" style="margin:20px auto; width:auto; display:inline-block;">
                    연습하러 가기
                </button>
            </div>
        `;
        return;
    }

    logs.forEach(log => {
        // KST Time
        const dateObj = new Date(log.session_date + "Z"); // Treat as UTC
        const dateStr = dateObj.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        const durationMin = Math.floor(log.duration_seconds / 60);
        const durationSec = log.duration_seconds % 60;

        let html = `<div class="question-card" style="background:#fafafa">
            <div style="border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:#58cc02;">${dateStr}</span>
                <span style="font-size:0.85rem; color:#888;">⏱ ${durationMin}분 ${durationSec}초 소요</span>
            </div>`;

        const details = log.details_json;
        if (details) {
            // Planning
            if (details.planning && details.planning.length > 0) {
                html += `<h4 style="margin:10px 0 5px; color:#1cb0f6;">[구상형]</h4>`;
                details.planning.forEach((q, idx) => {
                    const ans = details.answers[`plan_${idx}`] || "(답변 없음)";
                    html += `
                        <div style="margin-bottom:10px; padding-left:10px; border-left:3px solid #ddd;">
                            <p style="font-size:0.9rem; margin:5px 0;"><strong>Q${idx + 1}.</strong> ${q.content}</p>
                            <p style="font-size:0.9rem; color:#555; background:#fff; padding:5px; border-radius:5px;">💬 ${ans}</p>
                        </div>
                    `;
                });
            }

            // Immediate
            if (details.immediate && details.immediate.length > 0) {
                html += `<h4 style="margin:15px 0 5px; color:#ff4b4b;">[즉답형]</h4>`;
                details.immediate.forEach((q, idx) => {
                    const ans = details.answers[`imm_${idx}`] || "(답변 없음)";
                    html += `
                         <div style="margin-bottom:10px; padding-left:10px; border-left:3px solid #ddd;">
                            <p style="font-size:0.9rem; margin:5px 0;"><strong>Q${idx + 1}.</strong> ${q.content}</p>
                            <p style="font-size:0.9rem; color:#555; background:#fff; padding:5px; border-radius:5px;">💬 ${ans}</p>
                        </div>
                    `;
                });
            }
        }

        html += `</div>`;
        list.innerHTML += html;
    });
}
let currentCategory = "";
async function showQuestions(cat) {
    currentCategory = cat;
    goHome();
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('questions-view').classList.add('active');
    document.getElementById('q-view-title').innerText = `${cat} 문항관리`;

    loadQuestions(cat);
}

async function loadQuestions(cat = currentCategory) {
    const res = await fetch('/api/questions');
    const all = await res.json();
    const filtered = all.filter(q => q.category === cat);

    const list = document.getElementById('q-list-manage');
    list.innerHTML = "";
    filtered.forEach(q => {
        list.innerHTML += `
            <li class="question-card" style="margin-bottom:10px; display:flex; flex-direction:column; gap:5px;">
                <span style="font-weight:bold; color:#1cb0f6; font-size:0.95rem;">${q.title || '제목 없음'}</span>
                <span style="color:#555;">${q.content}</span>
            </li>
        `;
    });
}

async function addCurrentQuestion() {
    const content = document.getElementById('new-q-content').value;
    // Simple Prompt for title or default
    const title = prompt("문항 제목을 입력하세요 (예: 2023 기출):", "자체 제작 문제");

    if (!content) return;
    await fetch(`/api/questions?category=${encodeURIComponent(currentCategory)}&title=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}`, { method: 'POST' });
    document.getElementById('new-q-content').value = "";
    loadQuestions();
}

async function uploadExcel() {
    const file = document.getElementById('excel-upload').files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    // Pass current category
    await fetch(`/api/upload_excel?category=${encodeURIComponent(currentCategory)}`, { method: 'POST', body: formData });
    alert("업로드 완료");
    loadQuestions();
}

// --- Audio / TTS / STT Utils (Web Speech API) ---
function playTTS(text, callback) {
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'ko-KR';
    msg.rate = 1.0;
    msg.onend = () => { if (callback) callback(); };
    window.speechSynthesis.speak(msg);
}

// Web Speech API Variables
let recognition = null;

async function initAudio() {
    if (!('webkitSpeechRecognition' in window)) {
        alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.");
        return;
    }

    if (recognition) return; // Already initialized

    recognition = new webkitSpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        if (!window.currentTranscriptTarget || currentActiveQIndex === -1) return;

        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const target = document.getElementById(window.currentTranscriptTarget);

        // Clear placeholder if needed
        if (target.innerText.includes("대기 중") || target.innerText.includes("편하게 말씀")) {
            target.innerText = "";
        }

        // We only append final results to the session log logic, 
        // but for display we show everything. 
        // Note: Simple appending might duplicate text if not careful.
        // For simplicity in this structure, we just append finals.
        // Improved logic: update current block with interim, fix with final.

        // Since we are appending blindly in the previous logic, let's stick to appending finals
        if (finalTranscript) {
            target.innerText += finalTranscript + " ";
            target.scrollTop = target.scrollHeight;
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech verification error", event.error);
    };

    // Auto-restart if it stops unexpectedly while we are in a recording phase
    recognition.onend = () => {
        console.log("Speech recognition ended.");
        // If we are still in a recording state (e.g. currentActiveQIndex != -1), restart
        // But for now, we start/stop manually or let it run continuously during the session.
        // Let's rely on initAudio being called once.
        if (currentActiveQIndex !== -1 && recognition) {
            try { recognition.start(); } catch (e) { }
        }
    };

    try {
        recognition.start();
    } catch (e) {
        console.error(e);
    }
}

function stopAudio() {
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
}
