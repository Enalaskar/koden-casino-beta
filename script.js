
const activeUser = localStorage.getItem('active_session');

if (!activeUser && !window.location.href.includes('auth.html')) {
    window.location.href = 'auth.html';
}

let db = JSON.parse(localStorage.getItem('koden_db')) || {};
let balance = 0;
let stats = { totalProfit: 0, rounds: 0, wins: 0 };
let isSyncFinished = false; 
let lastRank = localStorage.getItem('persisted_rank') || null;
let lastKnownRank = null;

function showNotification(message, type = "info") {
    const container = document.getElementById('notification-container');
    if(!container) return;

    const toast = document.createElement('div');
    const colors = { success: "#22c55e", error: "#ef4444", info: "#8b5cf6" };
    
    toast.className = "bg-[#141417] border-l-4 px-6 py-4 rounded-xl flex items-center gap-4 pointer-events-auto min-w-[300px] shadow-2xl mb-2 transition-all duration-500";
    toast.style.borderColor = colors[type];
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";

    toast.innerHTML = `
        <div class="flex-1">
            <p class="text-[10px] font-black uppercase tracking-widest" style="color: ${colors[type]}">
                ${type === 'success' ? 'SYSTEM' : 'SYSTEM'}
            </p>
            <p class="text-xs font-bold text-white">${message}</p>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function getRankValue(rankName) {
    const ranks = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "CHAMPION"];
    return ranks.indexOf(rankName);
}

function playSound(filename) {
    const audio = new Audio(filename);
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Audio bloqué :", e));
}

function addToLogs(message, color = "#a78bfa") {
    const container = document.getElementById('logs-container');
    if (!container) return;
    const log = document.createElement('div');
    log.className = "flex justify-between border-b border-zinc-900 pb-1 animate-fadeIn";
    log.innerHTML = `<span style="color: ${color}">[${new Date().toLocaleTimeString()}]</span><span class="font-bold text-zinc-300 text-[10px]">${message}</span>`;
    container.prepend(log);
}


async function syncToFirebase(username, data) {
    if (!window.db_online || !window.fs) return;
    try {
        const { doc, setDoc } = window.fs;
        const userRef = doc(window.db_online, "users", username);
        await setDoc(userRef, data, { merge: true });
        console.log(`Cloud_Sync: ${username} mis à jour.`);
    } catch (e) { console.error("Erreur sync Firebase:", e); }
}

async function getFirebaseData(username) {
    if (!window.db_online || !window.fs) return null;
    try {
        const { doc, getDoc } = window.fs;
        const userRef = doc(window.db_online, "users", username);
        const userSnap = await getDoc(userRef);
        return userSnap.exists() ? userSnap.data() : null;
    } catch (e) { return null; }
}

function saveData() {
    if (!db[activeUser]) db[activeUser] = {};
    db[activeUser].coins = balance;
    db[activeUser].stats = stats;
    localStorage.setItem('koden_db', JSON.stringify(db));
    
    syncToFirebase(activeUser, {
        balance: Number(balance),
        stats: stats,
        lastUpdate: Date.now()
    });
}


async function refreshUserData() {
    if (!activeUser) return;
    try {
        const cloudData = await getFirebaseData(activeUser);
        if (cloudData) {
            balance = Number(cloudData.balance) || 0;
            
            if (cloudData.stats) {
                stats = {
                    totalProfit: Number(cloudData.stats.totalProfit) || 0,
                    rounds: Number(cloudData.stats.rounds) || 0,
                    wins: Number(cloudData.stats.wins) || 0,
                    profilePic: cloudData.stats.profilePic || "",
                    lastDailyClaim: cloudData.stats.lastDailyClaim || 0
                };
            }
            
            isSyncFinished = false; 
            displayStats();
            updateBalanceDisplay(balance);

            if (stats.profilePic) applyPP(stats.profilePic);

            checkDailyStatus();
            
            if (!window.dailyIntervalSet) {
                setInterval(checkDailyStatus, 60000);
                window.dailyIntervalSet = true;
            }

            setTimeout(() => {
                isSyncFinished = true;
                checkDailyStatus();
            }, 1500);
        }
    } catch (e) {
        console.error("Erreur refresh:", e);
        isSyncFinished = true;
    }
}

function updateBalanceDisplay(amount) {
    document.querySelectorAll('.balance-display, .balance-amount').forEach(display => {
        display.innerText = parseFloat(amount).toLocaleString(undefined, {
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2
        });
    });
}

function updateBalance(newAmount) {
    const oldRank = lastRank; 
    
    balance = newAmount;
    saveData();
    updateBalanceDisplay(balance);
    
    displayStats(); 
}

async function updateLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    if (!window.db_online || !window.fs || !window.fs.getDocs) {
        console.log("Leaderboard: En attente de Firebase...");
        setTimeout(updateLeaderboard, 1000);
        return;
    }

    try {
        const { collection, getDocs } = window.fs;
        const querySnapshot = await getDocs(collection(window.db_online, "users"));
        
        let players = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            players.push({ 
                name: doc.id, 
                amount: Number(data.balance) || 0,
                profilePic: data.stats ? data.stats.profilePic : null 
            });
        });

        players.sort((a, b) => b.amount - a.amount);
        if (players.length > 0) window.topPlayerId = players[0].name;

        container.innerHTML = players.slice(0, 10).map((p, i) => {
            const isMe = p.name === activeUser;
            
            let pRank = "BRONZE";
            let pColor = "#803f19";
            if (p.amount >= 100) { pRank = "CHAMPION"; pColor = "#cc1e1e"; }
            else if (p.amount >= 75) { pRank = "DIAMOND"; pColor = "#7760fa"; }
            else if (p.amount >= 50) { pRank = "PLATINUM"; pColor = "#34d399"; }
            else if (p.amount >= 25) { pRank = "GOLD"; pColor = "#fbbf24"; }
            else if (p.amount > 10) { pRank = "SILVER"; pColor = "#a0a0a0"; }

            const playerPP = p.profilePic ? 
                `<img src="${p.profilePic}" class="w-full h-full object-cover">` : 
                `<span class="text-[10px] opacity-40">👤</span>`;

            const isChampion = pRank === "CHAMPION";
            const championEffects = isChampion ? 'animate-pulse shadow-[0_0_10px_rgba(204,30,30,0.4)] border-[#cc1e1e]/50' : 'border-white/5';

            // --- MODIFICATION ICI : Ajout du onclick et du cursor-pointer ---
            return `
                <div onclick="viewPlayerProfile('${p.name}')" class="flex items-center justify-between py-2 px-2 border-b border-white/5 last:border-0 transition-all w-full cursor-pointer hover:bg-white/[0.02]
                    ${isMe ? 'bg-white/[0.04] rounded-xl' : ''}">
                    
                    <div class="flex items-center gap-3 overflow-hidden">
                        <span class="text-[10px] font-black w-4 shrink-0 ${i === 0 ? 'text-[#fbbf24]' : 'text-zinc-600'}">
                            ${(i+1)}
                        </span>
                        
                        <div class="flex items-center gap-3 shrink-0">
                            <div class="w-8 h-8 rounded-lg bg-[#0F0F12] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                ${playerPP}
                            </div>
                            <div class="flex flex-col leading-tight overflow-hidden">
                                <div class="flex items-center gap-2">
                                    <span class="text-[11px] font-bold uppercase tracking-tight truncate ${isMe ? 'text-[#8b5cf6]' : 'text-white/90'}">
                                        ${p.name}
                                    </span>
                                    
                                    <span class="text-[7px] font-black italic px-1.5 py-0.5 rounded bg-black/40 border ${championEffects} transition-all" style="color: ${pColor}">
                                        ${pRank}
                                    </span>
                                </div>
                                <span class="text-[7px] text-zinc-600 font-bold uppercase tracking-widest">
                                    ${i === 0 ? 'Top 1' : 'Player'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0 ml-2">
                        <span class="text-[10px] font-mono font-bold text-[#fbbf24]">
                            ${p.amount.toFixed(2)}
                        </span>
                        <img src="coin.png" class="w-3 h-3 animate-pulse" alt="coin">
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        container.innerHTML = "<div class='text-red-500 text-[9px] font-black p-4 text-center'>SYNC_ERROR</div>";
    }
}

function displayStats() {
    const pDisp = document.getElementById('stat-total-profit');
    const rDisp = document.getElementById('stat-total-rounds');
    const wDisp = document.getElementById('stat-win-rate');
    const rankDisp = document.getElementById('user-rank');
    if (!pDisp || !rankDisp) return;

    const profit = Number(stats.totalProfit) || 0;
    pDisp.innerText = (profit >= 0 ? "+" : "") + profit.toFixed(2);
    pDisp.style.color = profit >= 0 ? '#22c55e' : '#ef4444';
    rDisp.innerText = stats.rounds || 0;
    wDisp.innerText = (stats.rounds > 0 ? ((stats.wins / stats.rounds) * 100).toFixed(1) : 0) + "%";

    let currentRank = "BRONZE";
    let rankColor = "#803f19";

    if (balance >= 100) { currentRank = "CHAMPION"; rankColor = "#cc1e1e"; }
    else if (balance >= 75) { currentRank = "DIAMOND"; rankColor = "#1900ff"; }
    else if (balance >= 50) { currentRank = "PLATINUM"; rankColor = "#34d399"; }
    else if (balance >= 25) { currentRank = "GOLD"; rankColor = "#fbbf24"; }
    else if (balance > 10) { currentRank = "SILVER"; rankColor = "#a0a0a0"; }

    if (currentRank === "CHAMPION") {
        rankDisp.classList.add('animate-pulse');
        rankDisp.style.textShadow = "0 0 15px #cc1e1e"; 
    } else {
        rankDisp.classList.remove('animate-pulse');
        rankDisp.style.textShadow = "none";
    }
    lastRank = currentRank;
    rankDisp.innerText = currentRank;
    rankDisp.style.color = rankColor;

    if (stats.profilePic) {
        applyPP(stats.profilePic);
    }

    if (isSyncFinished && lastRank !== null && currentRank !== lastRank) {
        const isUp = getRankValue(currentRank) > getRankValue(lastRank);
        
        showNotification(
            `${isUp ? 'UPGRADE' : 'DOWNGRADE'} : ${currentRank}`, 
            isUp ? "success" : "error"
        );
        
        playSound(isUp ? 'rank-up-2.mp3' : 'rank-up-2.mp3');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    if (activeUser) {
        const nameDisplay = document.getElementById('nav-username');
        if (nameDisplay) nameDisplay.innerText = activeUser;
        
        await refreshUserData(); 
        updateLeaderboard();
        setInterval(updateLeaderboard, 30000);
    }
});

function logout() {
    localStorage.removeItem('active_session');
    window.location.href = 'auth.html';
}

async function deleteAccount() {
    if (confirm("⚠️ Action irréversible. Continuer ?")) {
        const { doc, deleteDoc } = window.fs;
        await deleteDoc(doc(window.db_online, "users", activeUser));
        delete db[activeUser];
        localStorage.setItem('koden_db', JSON.stringify(db));
        logout();
    }
}

function toggleProfileCard() {
    const card = document.getElementById('profile-card');
    if (!card) return;

    if (card.classList.contains('hidden')) {
        card.classList.remove('hidden');
        setTimeout(() => {
            window.addEventListener('click', closeOnClickOutside);
        }, 10);
    } else {
        card.classList.add('hidden');
        window.removeEventListener('click', closeOnClickOutside);
    }
}

function closeOnClickOutside(event) {
    const card = document.getElementById('profile-card');
    const button = document.querySelector('button[onclick="toggleProfileCard()"]');
    
    if (card && !card.contains(event.target) && !button.contains(event.target)) {
        card.classList.add('hidden');
        window.removeEventListener('click', closeOnClickOutside);
    }
}


async function changePP() {
    const url = prompt("Colle le lien (URL) de ton image (ex: https://image.com/maphoto.jpg) :");
    
    if (url && url.startsWith('http')) {
        if (!stats.profilePic) stats.profilePic = "";
        stats.profilePic = url;
        
        saveData();
        
        applyPP(url);
        showNotification("Photo de profil mise à jour !", "success");
    } else if (url) {
        showNotification("Lien invalide (doit commencer par http)", "error");
    }
}

function applyPP(url) {
    const img = document.getElementById('display-pp');
    const emoji = document.getElementById('display-emoji');
    
    if (url && url.trim() !== "") {
        img.src = url;
        img.classList.remove('hidden');
        emoji.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        emoji.classList.remove('hidden');
    }
}


async function claimDaily() {
    if (!activeUser) return;
    
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    const lastClaim = stats.lastDailyClaim || 0;
    
    if (now - lastClaim < oneDay) {
        const remaining = oneDay - (now - lastClaim);
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        showNotification(`Reviens dans ${hours}h pour ton prochain bonus !`, "error");
        return;
    }

    const reward = Math.floor(Math.random() * 11) + 5;
    
    balance += reward;
    stats.lastDailyClaim = now;
    
    updateBalanceDisplay(balance);
    saveData();
    
    showNotification(`MAGNIFIQUE ! Tu as reçu ${reward} coins !`, "success");
    playSound('rank-up-2.mp3');
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    
    checkDailyStatus();
}

function checkDailyStatus() {
    const btn = document.getElementById('daily-btn');
    const timerText = document.getElementById('daily-timer');
    if (!btn) return;

    if (!isSyncFinished) {
        btn.disabled = true;
        return;
    }

    const lastClaim = stats.lastDailyClaim || 0;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (now - lastClaim < oneDay) {
        btn.disabled = true;
        btn.classList.remove('animate-bounce');
        
        const remaining = oneDay - (now - lastClaim);
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
    } else {
        btn.disabled = false;
        btn.classList.add('animate-bounce');
    }
}

// FONCTION DE STATS CORRIGÉE
function updateGlobalStats(profit, win, countRound = true) {
    // 1. Mise à jour des stats de base
    stats.totalProfit = (Number(stats.totalProfit) || 0) + Number(profit);
    
    if (countRound) {
        stats.rounds = (Number(stats.rounds) || 0) + 1;
        
        // Gérer le Win Streak (Série de victoires)
        if (win) {
            stats.wins = (Number(stats.wins) || 0) + 1;
            stats.winStreak = (Number(stats.winStreak) || 0) + 1;
        } else {
            stats.winStreak = 0; // Reset la série en cas de défaite
        }

        // Gérer le Meilleur Gain (Highest Win)
        // On ne met à jour que si c'est une victoire supérieure au record précédent
        const currentProfit = Number(profit);
        if (win && currentProfit > (Number(stats.highestWin) || 0)) {
            stats.highestWin = currentProfit;
        }

        // 2. Enregistrement automatique dans l'historique (Graphiques)
        const path = window.location.pathname.split("/");
        const fileName = path[path.length - 1].split(".")[0] || "game";
        const gameName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
        
        // On récupère la mise stockée globalement par le jeu
        const betUsed = window.currentBet || 0;
        window.recordGame(gameName, betUsed, currentProfit);
    }

    // 3. Sauvegarde Firebase et rafraîchissement visuel
    saveData();
    if (typeof displayStats === "function") displayStats();
    if (typeof renderMiniChart === "function") renderMiniChart();
}

function toggleChangelog() {
    const modal = document.getElementById('changelog-modal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        if (typeof playSound === 'function') playSound('open.mp3'); 
    } else {
        modal.classList.add('hidden');
    }
}

let isChatOpen = false;

window.sendChatMessage = async function(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('chat-input');
    
    const msg = input.value.trim();
    if (!msg || !activeUser) return;

    const args = msg.split(" ");
    const command = args[0].toLowerCase();

    if (command === "/clear" && (activeUser === "kod" || activeUser === "Koden")) {
        try {
            const q = window.fs.query(window.fs.collection(window.db_online, "chat"), window.fs.limit(50));
            const snapshot = await window.fs.getDocs(q);
            const deletePromises = snapshot.docs.map(doc => window.fs.deleteDoc(doc.ref));
            await Promise.all(deletePromises);
            input.value = "";
            return;
        } catch (err) { console.error(err); }
    }

    if (command === "/help") {
        const isDev = activeUser === "kod" || activeUser === "Koden";
        
        let helpText = "Commandes disponibles : <br>";
        helpText += "• <b>/tip [pseudo] [montant]</b> : Envoyer des coins a un ami.<br>";
        helpText += "• <b>/help</b> : Afficher cette liste.";

        if (isDev) {
            helpText += "<br><br><b>[ADMIN]</b> :<br>";
            helpText += "• <b>/clear</b> : Reset le chat.<br>";
            helpText += "• <b>/announce [msg]</b> : Annonce globale.<br>";
            helpText += "• <b>/tournoi start [jeu] [min] [prize]</b> : Lancer un tournoi.<br>";
            helpText += "• <b>/tournoi end</b> : Terminer le tournoi.";
        }

        await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
            user: "System",
            text: helpText,
            rank: "SYSTEM",
            timestamp: window.fs.serverTimestamp()
        });

        input.value = "";
        return;
    }

    // Admin commands
    if (await handleAdminCommand(command, args)) { input.value=""; return; }

    if (command === "/tip") {
        const targetUser = args[1]?.trim();
        const amount = parseFloat(args[2]);

        if (!targetUser || isNaN(amount) || amount <= 0) {
            showNotification("Usage: /tip [pseudo] [montant]", "error");
            return;
        }

        if (balance < amount) {
            showNotification("Solde insuffisant !", "error");
            return;
        }

        try {
            const userRef = window.fs.collection(window.db_online, "users");
            const querySnapshot = await window.fs.getDocs(userRef);
            
            let targetDoc = null;
            let finalName = "";

            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                const nameInDb = data.username || docSnap.id; 
                
                if (nameInDb.toLowerCase() === targetUser.toLowerCase()) {
                    targetDoc = docSnap;
                    finalName = nameInDb;
                }
            });

            if (!targetDoc) {
                showNotification(`"${targetUser}" est introuvable`, "error");
                return;
            }

            if (finalName === activeUser) {
                showNotification("Action impossible sur soi-même", "error");
                return;
            }

            updateBalance(balance - amount);
            await window.fs.updateDoc(targetDoc.ref, {
                balance: window.fs.increment(amount)
            });

            await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
                user: "SYSTEM",
                text: `💸 @${activeUser} a envoyé ${amount.toFixed(2)} coins à @${finalName} !`,
                rank: "SYSTEM",
                timestamp: window.fs.serverTimestamp()
            });

            showNotification(`Tip envoyé à ${finalName} !`, "success");
            input.value = "";
            return;
        } catch (err) {
            console.error("Tip Error:", err);
            showNotification("Erreur de base de données", "error");
        }
    }

    try {
        const currentRank = localStorage.getItem('persisted_rank') || "BRONZE";

        await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
            user: activeUser,
            text: msg,
            rank: currentRank,
            profilePic: stats.profilePic || "",
            timestamp: window.fs.serverTimestamp()
        });
        input.value = "";
    } catch (err) { console.error("Chat Error:", err); }
};

window.getRankColor = function(rank) {
    const colors = { 
        "CHAMPION": "#cc1e1e",
        "DIAMOND": "#7760fa", 
        "PLATINUM": "#34d399", 
        "GOLD": "#fbbf24", 
        "SILVER": "#a0a0a0", 
        "BRONZE": "#cd7f32",
        "SYSTEM": "#8b5cf6"
    };
    if (!rank) return "#9ca3af";
    const cleanRank = String(rank).toUpperCase().trim();
    
    return colors[cleanRank] || "#9ca3af";
};

function initChatListener() {
    if (!window.db_online || !window.fs || !window.fs.query) {
        setTimeout(initChatListener, 500); 
        return;
    }

    const q = window.fs.query(
        window.fs.collection(window.db_online, "chat"), 
        window.fs.orderBy("timestamp", "desc"), 
        window.fs.limit(50)
    );
    
    window.fs.onSnapshot(q, (snapshot) => {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const messages = [];
        snapshot.forEach(doc => messages.push(doc.data()));
        
        container.innerHTML = messages.reverse().map(m => {
            const isSystem = m.rank === "SYSTEM";
            
            const isDev = (m.user === "kod") && !isSystem;
            

            const ppHtml = isSystem ? '' : `
                <div class="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-white/10 shadow-lg">
                    <img src="${m.profilePic || 'https://ui-avatars.com/api/?name=' + m.user}" class="w-full h-full object-cover">
                </div>
            `;
            const rankName = m.rank || "USER";
            const rankColor = "#b6b6b6";
            return `
            <div class="flex gap-3 items-start animate-fadeIn ${isSystem ? 'bg-[#8b5cf6]/10 border-l-2 border-[#8b5cf6] p-3 rounded-xl my-1' : 'py-1'}">
                ${ppHtml}
                <div class="flex-1 overflow-hidden">
                    <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">

                        ${isDev ? `
                            <span class="bg-[#ef4444] text-white text-[7px] px-1.5 py-0.5 rounded-md font-black italic shadow-[0_0_10px_rgba(239,68,68,0.4)] animate-pulse">
                                DEV
                            </span>
                        ` : ''}
                        
                        <span class="font-black text-[9px] uppercase tracking-tighter" style="color: ${isDev ? '#cc1e1e' : isSystem ? '#8b5cf6' : rankColor}">
                            ${m.user}
                        </span>
                    </div>
                    <p class="${isSystem ? 'text-[#8b5cf6] font-bold italic' : 'text-zinc-400'} text-[12px] leading-tight break-words pl-1">
                        ${m.text}
                    </p>
                </div>
            </div>
        `;
        }).join('');
        container.scrollTop = container.scrollHeight;
    });
}

window.addEventListener('DOMContentLoaded', initChatListener);

window.publishWinToChat = async function(gameName, amount, multiplier = null) {
    if (!activeUser || !window.fs || typeof window.fs.addDoc !== "function") return;

    if (amount < 49 && (!multiplier || multiplier < 2)) return;

    try {
        const text = multiplier 
            ? `a encaissé ${amount.toFixed(2)} coins (x${multiplier.toFixed(2)}) sur ${gameName} ! 🏆`
            : `a gagné ${amount.toFixed(2)} coins sur ${gameName} ! 🏆`;

        await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
            user: "SYSTEM",
            text: `📢 @${activeUser} ${text}`,
            rank: "SYSTEM",
            timestamp: (typeof window.fs.serverTimestamp === 'function') 
                ? window.fs.serverTimestamp() 
                : new Date() 
        });
    } catch (err) { 
        console.error("Annonce Chat Error:", err); 
    }
};



// ===== SYSTEME MUSIQUE =====
window.kodenMusic = (function() {
    let audio = null;
    let isPlaying = false;
    let vol = 0.3;

    function toggle() {
        if (!audio) {
            audio = new Audio('music2.mp3');
            audio.loop = true;
            audio.volume = vol;
        }
        if (isPlaying) { audio.pause(); isPlaying=false; }
        else { audio.play().catch(()=>{}); isPlaying=true; }
        updateMusicBtn();
        localStorage.setItem('koden_music', isPlaying?'1':'0');
    }

    function setVolume(v) {
        vol=v;
        if(audio) audio.volume=v;
    }

    function updateMusicBtn() {
        const btn = document.getElementById('music-toggle-btn');
        if(btn) {
            btn.textContent = isPlaying ? 'desole.' : 'zik?';
            btn.style.color = isPlaying ? '#22c55e' : '';
            btn.style.borderColor = isPlaying ? 'rgba(34,197,94,0.4)' : '';
        }
    }

    // Auto-resume if was playing
    window.addEventListener('DOMContentLoaded',()=>{
        updateMusicBtn();
        if(localStorage.getItem('koden_music')==='1') setTimeout(()=>toggle(),1000);
    });

    return { toggle, setVolume, get isPlaying(){ return isPlaying; } };
})();

// ===== ENREGISTREMENT HISTORIQUE =====
window.recordGame = function(game, bet, profit) {
    const user = activeUser || localStorage.getItem('active_session');
    if(!user) return;
    const key = 'koden_history_' + user;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { hist = []; }
    hist.push({ game, bet: Number(bet), profit: Number(profit), ts: Date.now() });
    if (hist.length > 500) hist = hist.slice(-500);
    localStorage.setItem(key, JSON.stringify(hist));
};

// ===== COMMANDES ADMIN TOURNOI =====
// /tournoi start [jeu] [duree_minutes] [prize]
// /tournoi end
// /announce [message]
// Accessible uniquement à l'admin (kod)
const ADMIN_USERS = ["kod", "Koden"];

function isAdmin() { return ADMIN_USERS.includes(activeUser); }

async function handleAdminCommand(command, args) {
    if (!window.db_online || !window.fs) { showNotification("Firebase non pret", "error"); return true; }

    if (command === "/announce" && isAdmin()) {
        const msg = args.slice(1).join(" ");
        if (!msg) { showNotification("Usage: /announce [message]", "error"); return true; }
        try {
            await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
                user: "ANNONCE",
                text: msg,
                rank: "SYSTEM",
                isAnnounce: true,
                timestamp: window.fs.serverTimestamp()
            });
            showNotification("Annonce envoyee !", "success");
        } catch(e) { console.error("Announce error:", e); showNotification("Erreur: "+e.message, "error"); }
        return true;
    }

    if (command === "/tournoi" && isAdmin()) {
        const sub = (args[1] || "").toLowerCase();
        if (sub === "start") {
            const jeu   = args[2] || "Tous jeux";
            const duree = parseInt(args[3]) || 60;
            const prize = parseInt(args[4]) || 100;
            const endsAt = Date.now() + duree * 60 * 1000;
            const tournamentData = { active: true, game: jeu, prize, endsAt, startedBy: activeUser, startedAt: Date.now() };

            try {
                // Use syncToFirebase pattern for meta document
                const { doc: fsDoc, setDoc: fsSetDoc } = window.fs;
                const ref = fsDoc(window.db_online, "meta", "tournament");
                await fsSetDoc(ref, tournamentData);

                await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
                    user: "TOURNOI",
                    text: "Tournoi <b>" + jeu + "</b> lance ! Duree: " + duree + " min — Prix: " + prize + " coins. Meilleur profit gagne !",
                    rank: "SYSTEM",
                    isAnnounce: true,
                    timestamp: window.fs.serverTimestamp()
                });
                showNotification("Tournoi lance !", "success");
            } catch(e) { console.error("Tournoi start error:", e); showNotification("Erreur Firebase: "+e.message, "error"); }

        } else if (sub === "end") {
            try {
                const { doc: fsDoc, setDoc: fsSetDoc } = window.fs;
                const ref = fsDoc(window.db_online, "meta", "tournament");
                await fsSetDoc(ref, { active: false, endsAt: 0 }, { merge: true });

                await window.fs.addDoc(window.fs.collection(window.db_online, "chat"), {
                    user: "TOURNOI",
                    text: "Le tournoi est termine ! Felicitations aux participants.",
                    rank: "SYSTEM",
                    isAnnounce: true,
                    timestamp: window.fs.serverTimestamp()
                });
                showNotification("Tournoi termine !", "info");
            } catch(e) { console.error("Tournoi end error:", e); showNotification("Erreur: "+e.message, "error"); }
        } else {
            showNotification("Usage: /tournoi start [jeu] [minutes] [coins]  ou  /tournoi end", "error");
        }
        return true;
    }
    return false;
}

// ===== ÉCOUTE TOURNOI EN COURS =====
function initTournamentBanner() {
    if(!window.db_online||!window.fs) return setTimeout(initTournamentBanner,800);
    window.fs.onSnapshot(window.fs.doc(window.db_online,"meta","tournament"), snap=>{
        if(!snap.exists()) return;
        const t=snap.data();
        let banner=document.getElementById('tournament-banner');
        if(t.active && t.endsAt > Date.now()) {
            if(!banner) {
                banner=document.createElement('div');
                banner.id='tournament-banner';
                banner.style.cssText='position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:200;background:#141417;border:1px solid rgba(251,191,36,0.4);border-radius:12px;padding:8px 20px;display:flex;align-items:center;gap:10px;font-family:sans-serif;box-shadow:0 0 30px rgba(251,191,36,0.15);';
                document.body.appendChild(banner);
            }
            const remaining=Math.max(0,Math.ceil((t.endsAt-Date.now())/60000));
            banner.innerHTML=`<span style="font-size:1rem;">&#x1F3C6;</span><span style="font-size:0.7rem;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#fbbf24;">TOURNOI ${t.game} — ${remaining}min — Prix: ${t.prize} coins</span>`;
        } else if(banner) { banner.remove(); }
    });
}
window.addEventListener('DOMContentLoaded', ()=>setTimeout(initTournamentBanner,1500));

async function resetGlobalChat() {
    const q = window.fs.query(window.fs.collection(window.db_online, "chat"), window.fs.limit(50));
    const snapshot = await window.fs.getDocs(q);
    
    snapshot.forEach(async (chatDoc) => {
        await window.fs.deleteDoc(window.fs.doc(window.db_online, "chat", chatDoc.id));
    });
    console.log("Chat nettoyé avec succès !");
}

// FONCTION POUR OUVRIR LA CARTE DU JOUEUR (MISE À JOUR)
window.viewPlayerProfile = async function(username) {
    const modal = document.getElementById('player-card-modal');
    if(!modal) return;

    try {
        const userRef = window.fs.doc(window.db_online, "users", username);
        const userSnap = await window.fs.getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            const s = data.stats || { totalProfit: 0, rounds: 0, wins: 0, winStreak: 0 };
            const userBalance = Number(data.balance) || 0;

            // 1. Mise à jour du Header (Nom, Solde, Rang)
            document.getElementById('player-card-username').innerText = username;
            document.getElementById('player-card-balance').innerText = userBalance.toFixed(2);
            
            let pRank = "BRONZE", pColor = "#803f19";
            if (userBalance >= 100) { pRank = "CHAMPION"; pColor = "#cc1e1e"; }
            else if (userBalance >= 75) { pRank = "DIAMOND"; pColor = "#7760fa"; }
            else if (userBalance >= 50) { pRank = "PLATINUM"; pColor = "#34d399"; }
            else if (userBalance >= 25) { pRank = "GOLD"; pColor = "#fbbf24"; }
            else if (userBalance > 10) { pRank = "SILVER"; pColor = "#a0a0a0"; }

            const badge = document.getElementById('player-card-rank-badge');
            badge.innerText = pRank;
            badge.style.color = pColor;
            badge.style.borderColor = pColor + "44";

            // 2. Colonne Gauche
            const profit = Number(s.totalProfit || 0);
            const pEl = document.getElementById('player-card-profit');
            pEl.innerText = (profit >= 0 ? '+' : '') + profit.toFixed(2);
            pEl.style.color = profit >= 0 ? '#22c55e' : '#ef4444';

            document.getElementById('player-card-wins').innerText = s.wins || 0;
            document.getElementById('player-card-losses').innerText = (Number(s.rounds || 0)) - (Number(s.wins || 0));
            document.getElementById('player-card-rounds').innerText = s.rounds || 0;
            document.getElementById('player-card-streak').innerText = s.winStreak || 0;

            // 3. Colonne Droite & Win Rate
            const avgBet = s.rounds > 0 ? (Math.abs(profit) / s.rounds).toFixed(2) : "0.00";
            document.getElementById('player-card-avg-bet').innerText = avgBet;

            const wr = s.rounds > 0 ? Math.round((s.wins / s.rounds) * 100) : 0;
            document.getElementById('player-card-wr-text').innerText = wr + "%";
            
            const circle = document.getElementById('wr-circle');
            const circumference = 2 * Math.PI * 40;
            const offset = circumference - (wr / 100) * circumference;
            circle.style.strokeDashoffset = offset;

            // Photo de profil
            const ppImg = document.getElementById('player-card-pp');
            const emojiSpan = document.getElementById('player-card-emoji');
            const pfp = s.profilePic || "";
            if (pfp) {
                ppImg.src = pfp; ppImg.classList.remove('hidden'); emojiSpan.classList.add('hidden');
            } else {
                ppImg.classList.add('hidden'); emojiSpan.classList.remove('hidden');
            }

            modal.classList.remove('hidden');
        }
    } catch (e) { console.error("Erreur profil:", e); }
};

let miniChartInstance = null;

function renderMiniChart() {
    const canvas = document.getElementById('user-panel-chart');
    if (!canvas) return;

    const raw = localStorage.getItem('koden_history_' + activeUser);
    const historyData = raw ? JSON.parse(raw) : [];

    if (historyData.length === 0) return;

    let cum = 0;
    // On prend les 20 dernières parties pour ne pas surcharger
    const points = historyData.slice(-20).map(h => { cum += h.profit; return cum; });
    const labels = points.map((_, i) => i + 1);

    if (miniChartInstance) miniChartInstance.destroy();

    miniChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: points,
                borderColor: points[points.length - 1] >= 0 ? '#22c55e' : '#ef4444',
                borderWidth: 2,
                fill: true,
                backgroundColor: points[points.length - 1] >= 0 ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                tension: 0.4,
                pointRadius: 2, // On affiche les points pour mieux voir les étapes
                pointBackgroundColor: points[points.length - 1] >= 0 ? '#22c55e' : '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: {
                        color: '#3f3f46', // Gris très foncé pour l'axe X
                        font: { size: 7 }
                    }
                },
                y: {
                    display: true,
                    grid: { color: 'rgba(255,255,255,0.03)' }, // Grille presque invisible
                    ticks: {
                        color: '#71717a', // Gris clair pour les montants
                        font: { size: 8, family: 'monospace' },
                        callback: function(value) {
                            return (value >= 0 ? '+' : '') + Math.round(value);
                        }
                    }
                }
            }
        }
    });
}

// Modifier ta fonction displayStats existante pour appeler le graphique
const originalDisplayStats = displayStats;
displayStats = function() {
    if (typeof originalDisplayStats === "function") originalDisplayStats();
    renderMiniChart();
};

// FONCTION POUR FERMER LA CARTE
window.closePlayerCard = function() {
    document.getElementById('player-card-modal').classList.add('hidden');
};