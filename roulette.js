const colors = { red: "#cc1e1e", black: "#1a1a1e", green: "#22c55e" };
const wheelOrder = [0, 11, 5, 10, 6, 9, 7, 8, 1, 14, 2, 13, 3, 12, 4];
const cardWidth = 80;
let isSpinning = false;
let currentBet = { amount: 0, color: null };
let currentRoundId = "";
let lastFirebaseData = null;
let lastTickAngle = 0;
let isProcessingBet = false;
let lastBetTimestamp = 0;
let hasPlacedBetThisRound = false;

window.addEventListener('DOMContentLoaded', () => {
    generateWheel();
    initRouletteSync();
    setTimeout(initBetsListener, 1000);
});

async function initRouletteSync() {
    if (!window.fs || !window.db_online) return setTimeout(initRouletteSync, 500);
    const rouletteRef = window.fs.doc(window.db_online, "games", "roulette");

    try {
        const docSnap = await window.fs.getDoc(rouletteRef);
        if (!docSnap.exists()) {
            await window.fs.setDoc(rouletteRef, {
                timeLeft: 15, status: "betting", winningNumber: 0,
                lastUpdate: Date.now(), currentRoundId: "INIT-" + Date.now()
            });
        }
    } catch (e) { console.error(e); }

    let lastHandledRoundId = "";

    window.fs.onSnapshot(rouletteRef, (doc) => {
        const data = doc.data();
        if (!data) return;
        lastFirebaseData = data; 
        
        currentRoundId = data.currentRoundId;
        updateTimerUI(data.timeLeft, data.status);
        
        if (data.status === "spinning" && !isSpinning) {
            startSpin(data.winningNumber);
        }

        if (data.status === "betting" && data.currentRoundId !== lastHandledRoundId) {
            lastHandledRoundId = data.currentRoundId;
            
            isSpinning = false;
            hasPlacedBetThisRound = false; 
            currentBet = { amount: 0, color: null };

            const betButtons = document.querySelectorAll('button[onclick^="placeBet"]');
            betButtons.forEach(btn => {
                btn.style.pointerEvents = "auto";
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
                
                if (btn.getAttribute('data-onclick')) {
                    btn.setAttribute('onclick', btn.getAttribute('data-onclick'));
                }
            });

            const list = document.getElementById('winners-list');
            if (list) {
                list.classList.add('opacity-0', 'scale-95');
                setTimeout(() => {
                    const container = document.getElementById('winners-container');
                    if(container) container.innerHTML = '';
                }, 500);
            }
        }
    });

    setInterval(() => {
        if (lastFirebaseData) {
            const now = Date.now();
            if (now - lastFirebaseData.lastUpdate >= 1000) {
                handleMasterTimer(lastFirebaseData);
            }
        }
    }, 1000);
}

async function handleMasterTimer(data) {
    let newTime = data.timeLeft - 1;
    let newStatus = data.status;
    let winningNumber = data.winningNumber || 0;
    let newRoundId = data.currentRoundId;

    if (newTime <= 0) {
        if (newStatus === "betting") {
            newStatus = "spinning";
            newTime = 10;
            winningNumber = wheelOrder[Math.floor(Math.random() * wheelOrder.length)];
        } else {
            newStatus = "betting";
            newTime = 15;
            newRoundId = "RD-" + Date.now();
            clearFirebaseBets();
        }
    }

    await window.fs.updateDoc(window.fs.doc(window.db_online, "games", "roulette"), {
        timeLeft: newTime,
        status: newStatus,
        winningNumber: winningNumber,
        currentRoundId: newRoundId,
        lastUpdate: Date.now()
    });
}

function updateTimerUI(time, status) {
    const text = document.getElementById('timer-text');
    const bar = document.getElementById('timer-bar');
    if (!text || !bar) return;

    text.innerText = time;
    
    const maxTime = status === "betting" ? 15 : 10;
    
    const progress = time / maxTime;
    const offset = 314.16 * (1 - progress);
    
    bar.style.strokeDashoffset = offset;
    
    if (status === "betting") {
        bar.style.stroke = "#8b5cf6";
        bar.parentElement.classList.remove('opacity-50');
    } else {
        bar.style.stroke = "#ef4444";
        bar.parentElement.classList.add('opacity-50');
    }
}

function startSpin(winningNumber) {
    if (isSpinning) return;
    isSpinning = true;

    const wheel = document.getElementById('wheel-container');
    const sliceAngle = 360 / wheelOrder.length;
    const index = wheelOrder.indexOf(winningNumber);
    
    wheel.style.transition = "none"; 
    wheel.style.transform = "rotate(0deg)";
    
    void wheel.offsetWidth; 

    const extraSpins = 10 * 360; 
    const finalRotation = extraSpins + (270 - (index * sliceAngle) - (sliceAngle / 2));

    wheel.style.transition = "transform 8s cubic-bezier(0.15, 0, 0.1, 1)";
    wheel.style.transform = `rotate(${finalRotation}deg)`;

    requestAnimationFrame(monitorWheelTick);

    setTimeout(() => {
        checkGains(winningNumber);
    }, 8500);
}

function resetWheelUI() {
    isSpinning = false;
    const wheel = document.getElementById('wheel-container');
    if (wheel) {
        wheel.style.transition = "none";
        wheel.style.transform = "rotate(0deg)";
    }
}

function checkGains(winningNumber) {
    if (currentBet.amount <= 0 || winningNumber === null) return;

    const winColor = winningNumber === 0 ? "green" : (winningNumber % 2 === 0 ? "black" : "red");
    
    let profit = 0;
    let isWin = false;

    if (currentBet.color === winColor) {
        const multiplier = winColor === "green" ? 14 : 2;
        const payout = currentBet.amount * multiplier;
        profit = payout - currentBet.amount;
        isWin = true;

        updateBalance(balance + payout);
        showNotification(`GAGNÉ ! +${payout.toFixed(0)}`, "success");
        playSound('rank-up-2.mp3');
        addWinnerBubble(activeUser, payout.toFixed(0));
    } else {
        profit = -currentBet.amount;
        isWin = false;
        showNotification(`PERDU !`, "error");
    }

    if (typeof updateGlobalStats === "function") {
        updateGlobalStats(profit, isWin, true); 
    }
}

function addWinnerBubble(username, amount) {
    const list = document.getElementById('winners-list');
    const container = document.getElementById('winners-container');
    if (!list || !container) return;

    list.classList.remove('opacity-0', 'scale-95');

    const bubble = document.createElement('div');
    bubble.className = "flex items-center gap-3 bg-[#141417]/80 backdrop-blur-md border border-green-500/30 px-4 py-2 rounded-xl animate-fadeInLeft";
    bubble.innerHTML = `
        <div class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
        <span class="text-[11px] font-black uppercase text-white/90">${username}</span>
        <span class="text-[11px] font-mono font-bold text-green-400">+${amount}</span>
    `;

    container.appendChild(bubble);
}

async function placeBet(color) {
    const input = document.getElementById('roulette-bet-input');
    const amount = parseFloat(input.value);

    if (hasPlacedBetThisRound || isSpinning || lastFirebaseData?.status !== "betting") {
        return showNotification("Action impossible", "error");
    }

    if (isNaN(amount) || amount <= 0 || amount > balance) {
        return showNotification("Montant invalide", "error");
    }

    hasPlacedBetThisRound = true;

    const betButtons = document.querySelectorAll('button[onclick^="placeBet"]');
    betButtons.forEach(btn => {
        btn.style.opacity = "0.5";
        btn.style.pointerEvents = "none";
    });

    try {
        currentBet = { amount, color };
        updateBalance(balance - amount);
        await saveData();
        
        await window.fs.addDoc(window.fs.collection(window.db_online, "roulette_bets"), {
            user: activeUser, 
            amount: amount, 
            color: color,
            profilePic: stats.profilePic || "", 
            timestamp: window.fs.serverTimestamp()
        });
        
        showNotification("Mise acceptée !", "success");
    } catch (error) {
        hasPlacedBetThisRound = false;
        currentBet = { amount: 0, color: null };
        updateBalance(balance + amount);
        betButtons.forEach(btn => {
            btn.style.opacity = "1";
            btn.style.pointerEvents = "auto";
        });
    }
}

function initBetsListener() {
    if (!window.fs || !window.fs.query) return setTimeout(initBetsListener, 500);
    
    const q = window.fs.query(
        window.fs.collection(window.db_online, "roulette_bets"), 
        window.fs.orderBy("timestamp", "desc"), 
        window.fs.limit(10)
    );

    window.fs.onSnapshot(q, (snapshot) => {
        const log = document.getElementById('all-bets-log');
        if (!log) return;
        log.innerHTML = '';

        snapshot.forEach(doc => {
            const bet = doc.data();
            const colorClass = bet.color === 'red' ? 'bg-[#cc1e1e]' : (bet.color === 'green' ? 'bg-[#22c55e]' : 'bg-zinc-800');
            
            log.innerHTML += `
                <div class="flex items-center justify-between bg-[#0F0F12] p-2.5 rounded-xl border border-white/5 animate-fadeIn">
                    <div class="flex items-center gap-2">
                        <div class="w-1.5 h-6 ${colorClass} rounded-full shadow-lg"></div>
                        <div class="flex flex-col">
                            <span class="text-[9px] font-bold text-white uppercase tracking-tighter">${bet.user}</span>
                            <span class="text-[7px] text-zinc-500 font-bold uppercase tracking-widest">${bet.color}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[10px] font-black text-[#fbbf24] font-mono">${bet.amount}</span>
                    </div>
                </div>
            `;
        });
    });
}

async function clearFirebaseBets() {
    if (!window.fs || !window.fs.getDocs) return;
    const snapshot = await window.fs.getDocs(window.fs.collection(window.db_online, "roulette_bets"));
    snapshot.forEach(d => window.fs.deleteDoc(d.ref));
}

function generateWheel() {
    const canvas = document.getElementById('roulette-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 15;
    const sliceAngle = (2 * Math.PI) / wheelOrder.length;

    ctx.clearRect(0, 0, size, size);

    wheelOrder.forEach((num, i) => {
        const angle = i * sliceAngle;
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(center, center);
        
        const baseColor = num === 0 ? colors.green : (num % 2 === 0 ? colors.black : colors.red);
        const grad = ctx.createRadialGradient(center, center, radius * 0.5, center, center, radius);
        grad.addColorStop(0, baseColor); 
        grad.addColorStop(1, "#000000"); 

        ctx.fillStyle = grad;
        ctx.arc(center, center, radius, angle, angle + sliceAngle);
        ctx.fill();

        ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(angle + sliceAngle / 2);
        
        ctx.shadowBlur = 4;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowOffsetY = 2;
        
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 24px 'Inter', sans-serif"; 
        ctx.fillText(num, radius - 35, 8);
        ctx.restore();
    });

    ctx.beginPath();
    const chromeGrad = ctx.createLinearGradient(0, 0, size, size);
    chromeGrad.addColorStop(0, "#1a1a1e");
    chromeGrad.addColorStop(0.5, "#4a4a4f");
    chromeGrad.addColorStop(1, "#1a1a1e");
    ctx.strokeStyle = chromeGrad;
    ctx.lineWidth = 10;
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    const hubGrad = ctx.createRadialGradient(center, center, 0, center, center, 60);
    hubGrad.addColorStop(0, "#3f3f46");
    hubGrad.addColorStop(1, "#09090b");
    
    ctx.beginPath();
    ctx.fillStyle = hubGrad;
    ctx.shadowBlur = 20;
    ctx.shadowColor = "black";
    ctx.arc(center, center, 60, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#fbbf24";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#fbbf24";
    ctx.arc(center, center, 8, 0, Math.PI * 2);
    ctx.fill();
}

function monitorWheelTick() {
    if (!isSpinning) return;

    const wheel = document.getElementById('wheel-container');
    const style = window.getComputedStyle(wheel);
    const matrix = new WebKitCSSMatrix(style.transform);
    const currentAngle = Math.atan2(matrix.m12, matrix.m11) * (180 / Math.PI);
    
    const sliceAngle = 360 / wheelOrder.length;
    
    if (Math.abs(currentAngle - lastTickAngle) >= sliceAngle) {
        lastTickAngle = currentAngle;
        
        const arrow = document.querySelector('.clip-path-triangle');
        if(arrow) {
            arrow.style.transform = 'translateX(-50%) rotate(-10deg)';
            setTimeout(() => arrow.style.transform = 'translateX(-50%) rotate(0deg)', 50);
        }
    
    }
    
    requestAnimationFrame(monitorWheelTick);
}
