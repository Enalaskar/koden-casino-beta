let playerHand = [];
let dealerHand = [];
let deck = [];
let currentBet = 0;
let isGameOver = true;

window.startGame = async function() {
    if (!isGameOver) return;

    const res = document.getElementById('game-result');
    res.style.opacity = "0";
    res.classList.remove('result-pop');

    const userId = localStorage.getItem('active_session');
    if (!userId) return alert("Veuillez vous connecter.");

    const betInput = document.getElementById('bet-amount'); 
    currentBet = parseInt(betInput.value);

    if (isNaN(currentBet) || currentBet < 0) return alert("Mise mini: 1 coins");
    if (currentBet > balance) return alert("Solde insuffisant !");

    try {
        const userRef = window.fs.doc(window.db_online, "users", userId);
        
        await window.fs.updateDoc(userRef, { balance: window.fs.increment(-currentBet) });
        
        balance -= currentBet; 
        if (typeof updateBalanceDisplay === "function") updateBalanceDisplay(balance);

        if (typeof updateGlobalStats === "function") {
            updateGlobalStats(-currentBet, false, false);
        }

        if (typeof addToLogs === "function") {
            addToLogs(`DEAL: -${currentBet.toFixed(2)} COINS`, "#8b5cf6");
        }

        isGameOver = false;
        createDeck();
        playerHand = [deck.pop(), deck.pop()];
        dealerHand = [deck.pop(), deck.pop()];

        updateUI();
        document.getElementById('deal-btn').classList.add('hidden');
        document.getElementById('game-controls').classList.remove('hidden');
    } catch (e) {
        console.error("Erreur lancement Blackjack:", e);
    }
};

window.hit = function() {
    if (isGameOver) return;
    playerHand.push(deck.pop());
    const score = calculateScore(playerHand);
    updateUI();
    
    addToLogs(`USER_HIT: NEW_SCORE ${score}`, "#a78bfa");

    if (score > 21) {
        endGame("AIE! (>21)", "#ef4444");
    }
};

window.stand = async function() {
    if (isGameOver) return;
    
    while (calculateScore(dealerHand) < 17 ) {
        dealerHand.push(deck.pop());
        updateUI(true);
        await new Promise(r => setTimeout(r, 600));
    }
    updateUI(true);
    
    const pScore = calculateScore(playerHand);
    const dScore = calculateScore(dealerHand);
    const userId = localStorage.getItem('active_session');
    const userRef = window.fs.doc(window.db_online, "users", userId);

    if (dScore > 21 || pScore > dScore) {
        const win = currentBet * 2;
        await window.fs.updateDoc(userRef, { balance: window.fs.increment(win) });
        balance += win;
        endGame("GAGNÉ ! +" + win, "#22c55e");
    } else if (pScore === dScore) {
        await window.fs.updateDoc(userRef, { balance: window.fs.increment(currentBet) });
        balance += currentBet;
        endGame("ÉGALITÉ", "#24e2fb");
    } else {
        endGame("PERDU", "#ef4444");
    }
    
    if (typeof updateBalanceDisplay === "function") updateBalanceDisplay(balance);
};

function createDeck() {
    const suits = ["♠", "♣", "♥", "♦"];
    const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v });
    }
    deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
    let score = 0, aces = 0;
    for (let c of hand) {
        if (["J", "Q", "K"].includes(c.value)) score += 10;
        else if (c.value === "A") { score += 11; aces++; }
        else score += parseInt(c.value);
    }
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

function updateUI(showDealer = false) {
    document.getElementById('player-cards').innerHTML = playerHand.map((c, i) => renderCard(c, i)).join('');
    document.getElementById('dealer-cards').innerHTML = dealerHand.map((c, i) => 
        (i === 0 || showDealer) ? renderCard(c, i) : renderBackCard(i)
    ).join('');
    document.getElementById('player-score').innerText = "Score: " + calculateScore(playerHand);
    document.getElementById('dealer-score').innerText = showDealer ? "Score: " + calculateScore(dealerHand) : "Score: ?";
}

function renderCard(card, index) {
    const isRed = card.suit === "♥" || card.suit === "♦";
    const delay = index * 0.1;
    return `
        <div class="w-28 h-40 bg-white rounded-xl flex flex-col items-center justify-center shadow-2xl text-black font-black text-3xl border-b-4 border-zinc-300 relative overflow-hidden"
             style="animation: dealIn 0.4s ease-out ${delay}s forwards; opacity: 0; transform: translateY(-30px);">
            <div class="absolute top-2 left-2 text-xs flex flex-col items-center leading-none">
                <span style="color:${isRed ? '#ef4444' : '#18181b'}">${card.value}</span>
                <span class="text-[10px]" style="color:${isRed ? '#ef4444' : '#18181b'}">${card.suit}</span>
            </div>
            <span class="text-5xl" style="color:${isRed ? '#ef4444' : '#18181b'}">${card.suit}</span>
            <div class="absolute bottom-2 right-2 text-xs flex flex-col items-center leading-none rotate-180">
                <span style="color:${isRed ? '#ef4444' : '#18181b'}">${card.value}</span>
                <span class="text-[10px]" style="color:${isRed ? '#ef4444' : '#18181b'}">${card.suit}</span>
            </div>
        </div>`;
}

function renderBackCard(index) {
    const delay = index * 0.1;
    return `
        <div class="w-28 h-40 bg-gradient-to-br from-[#8b5cf6] to-[#6d28d9] rounded-xl border-4 border-white/10 shadow-2xl flex items-center justify-center"
             style="animation: dealIn 0.4s ease-out ${delay}s forwards; opacity: 0; transform: translateY(-30px);">
            <div class="text-white/20 font-black text-5xl italic">K</div>
        </div>`;
}

function endGame(msg, color) {
    // Record in history
    try {
        const isWin = msg.includes("GAGN") || msg.includes("WIN") || msg.includes("BLACK");
        const profit = isWin ? (msg.includes("BLACKJACK") ? Math.floor(currentBet*1.5) : currentBet) : -currentBet;
        if(typeof window.recordGame==="function") window.recordGame("Blackjack", currentBet, profit);
    } catch(e){}
    isGameOver = true;
    const res = document.getElementById('game-result');
    res.innerText = msg;
    res.style.color = color;
    res.style.opacity = "1";
    res.classList.add('result-pop');

    if (typeof updateGlobalStats === "function") {
        if (msg.includes("GAGNÉ")) {
            const totalWin = currentBet * 2;
            updateGlobalStats(totalWin, true);
            
            if (typeof addToLogs === "function") {
                addToLogs(`WIN: +${totalWin.toFixed(2)} COINS`, "#fbbf24");
                window.publishWinToChat("Blackjack", totalWin);
            }   
        } 
        else if (msg.includes("PUSH") || msg.includes("ÉGALITÉ")) {
            updateGlobalStats(currentBet, false);
            
            if (typeof addToLogs === "function") {
                addToLogs(`PUSH: +${currentBet.toFixed(2)} COINS (REFUND)`, "#24e2fb");
            }
        } 
        else {
            updateGlobalStats(0, false);
            
            if (typeof addToLogs === "function") {
                addToLogs(`LOSS: -${currentBet.toFixed(2)} COINS`, "#ef4444");
            }
        }
    }

    if (typeof saveData === "function") {
        saveData();
    }

    document.getElementById('deal-btn').classList.remove('hidden');
    document.getElementById('game-controls').classList.add('hidden');
}