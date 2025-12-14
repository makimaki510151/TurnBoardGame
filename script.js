// ===================================
// 定数と状態管理
// ===================================

const TILE_SIZE = 10;
let socket = null;
let localCharacter = null; // ゲームに持ち込む選択されたキャラクターのオリジナルデータ
let currentUnit = null;    // 現在のターンで操作する自分のユニットの状態
let gameState = null;      // サーバーから受信した最新のゲーム全体状態
let isHost = false;
const MAX_BASE_POINTS = 5; // 初期レベル1の基本ポイント
let availableSkills = []; // skills.jsonから読み込まれるスキルデータ
let activeAction = null;   // 'move', 'skill' のいずれか

// ===================================
// キャラクター制作・管理
// ===================================

/**
 * skills.jsonからスキルデータを非同期で読み込む
 */
async function fetchSkills() {
    try {
        const response = await fetch('skills.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        availableSkills = await response.json();
        populateSkillSelectors();
    } catch (error) {
        console.error('スキルデータの読み込みに失敗しました:', error);
        alert('スキルデータの読み込みに失敗しました。ファイル(skills.json)を確認してください。');
    }
}

/**
 * 読み込んだスキルデータでセレクタを埋める
 */
function populateSkillSelectors() {
    const selector1 = document.getElementById('char-skill-1');
    const selector2 = document.getElementById('char-skill-2');

    selector1.innerHTML = '<option value="">-- スキルを選択 --</option>';
    selector2.innerHTML = '<option value="">-- スキルを選択 --</option>';

    availableSkills.forEach(skill => {
        const option1 = new Option(`${skill.name} (コスト: ${skill.cost})`, skill.id);
        const option2 = new Option(`${skill.name} (コスト: ${skill.cost})`, skill.id);
        selector1.add(option1);
        selector2.add(option2);
    });
    
    selector1.onchange = () => updateSkillDescription(1);
    selector2.onchange = () => updateSkillDescription(2);
    
    updateSkillDescription(1);
    updateSkillDescription(2);
}

/**
 * 選択されたスキルの説明文を更新する
 * @param {number} index - スキルセレクタのインデックス (1 or 2)
 */
function updateSkillDescription(index) {
    const selector = document.getElementById(`char-skill-${index}`);
    const descElement = document.getElementById(`skill-desc-${index}`);
    const selectedId = parseInt(selector.value);
    
    if (!selectedId) {
        descElement.textContent = 'スキルが選択されていません。';
        return;
    }
    
    const skill = availableSkills.find(s => s.id === selectedId);
    if (skill) {
        descElement.textContent = 
            `[${skill.type}] ${skill.description} (依存ステ: ${skill.stat_dependency}, 射程: ${skill.range_type} ${skill.range_value}, 形状: ${skill.target_shape})`;
    } else {
        descElement.textContent = 'エラー: スキルデータが見つかりません。';
    }
}


/**
 * 現在のレベルとステータス配分に基づいて残りポイントを更新する
 */
function updateStatsAllocation() {
    const level = parseInt(document.getElementById('char-level').value) || 1;
    const str = parseInt(document.getElementById('stat-str').value) || 1;
    const dex = parseInt(document.getElementById('stat-dex').value) || 1;
    const vit = parseInt(document.getElementById('stat-vit').value) || 1;
    const int = parseInt(document.getElementById('stat-int').value) || 1;
    const agi = parseInt(document.getElementById('stat-agi').value) || 1;
    const luk = parseInt(document.getElementById('stat-luk').value) || 1;

    // レベルに応じた合計割り振り可能ポイント
    const totalAllocatablePoints = MAX_BASE_POINTS + (level - 1) * 3;
    
    // 基礎値(1)を除いた割り振りポイントを計算
    const currentlyUsedPoints = (str - 1) + (dex - 1) + (vit - 1) + (int - 1) + (agi - 1) + (luk - 1); 
    const remainingPoints = totalAllocatablePoints - currentlyUsedPoints;

    document.getElementById('remaining-points').innerText = remainingPoints;

    if (remainingPoints < 0) {
        document.getElementById('remaining-points').style.color = 'red';
    } else {
        document.getElementById('remaining-points').style.color = 'green';
    }
    
    return remainingPoints;
}

/**
 * フォーム入力に基づいてキャラクターオブジェクトを生成する
 * @returns {object | null} 制作されたキャラクターデータ
 */
function createCharacter() {
    const remainingPoints = updateStatsAllocation();

    if (remainingPoints !== 0) {
        alert('ステータスポイントを正しく割り振ってください。');
        return null;
    }

    const name = document.getElementById('char-name').value;
    const level = parseInt(document.getElementById('char-level').value);
    const str = parseInt(document.getElementById('stat-str').value);
    const dex = parseInt(document.getElementById('stat-dex').value);
    const vit = parseInt(document.getElementById('stat-vit').value);
    const int = parseInt(document.getElementById('stat-int').value);
    const agi = parseInt(document.getElementById('stat-agi').value);
    const luk = parseInt(document.getElementById('stat-luk').value);
    
    const skillId1 = parseInt(document.getElementById('char-skill-1').value);
    const skillId2 = parseInt(document.getElementById('char-skill-2').value);
    
    if (!skillId1) {
        alert('スキル1を選択してください。');
        return null;
    }
    if (skillId1 === skillId2) {
        alert('スキルは重複して選択できません。');
        return null;
    }

    const selectedSkills = [skillId1, skillId2]
        .filter(id => id) 
        .map(id => availableSkills.find(s => s.id === id));
    
    if (selectedSkills.some(s => !s)) {
        alert('選択されたスキルデータにエラーがあります。');
        return null;
    }
    
    // **移動力(MOVE)の決定ロジック**: (例: AGI + LUK / 2)
    const baseMove = Math.max(3, agi + Math.floor(luk / 2)); 

    const newChar = {
        id: Date.now(), 
        name: name,
        level: level,
        stats: {
            STR: str,
            DEX: dex,
            VIT: vit,
            INT: int,
            AGI: agi,
            LUK: luk,
            MAX_HP: 50 + vit * 10, 
            CURRENT_HP: 50 + vit * 10,
            MAX_MOVE: baseMove,
            CURRENT_MOVE: baseMove, // 初期移動力
        },
        skills: selectedSkills, 
        createdAt: new Date().toISOString()
    };
    
    localCharacter = newChar;
    document.getElementById('current-selected-char').innerText = 
        `${newChar.name} (Lv.${newChar.level}, HP:${newChar.stats.MAX_HP}, MOVE:${newChar.stats.MAX_MOVE})`;

    updateSkillButtons(newChar.skills);
    
    return newChar;
}

/**
 * 作成されたキャラクターのスキルに基づいて、ゲーム中のアクションボタンを更新する
 * @param {Array<object>} skills - キャラクターが持つスキルリスト
 */
function updateSkillButtons(skills) {
    const skillButtonContainer = document.getElementById('skill-buttons');
    skillButtonContainer.innerHTML = '';
    
    skills.forEach((skill, index) => {
        const button = document.createElement('button');
        button.onclick = () => handleSkillAction(index); 
        button.textContent = skill.name;
        button.title = `${skill.description} (コスト: ${skill.cost})`;
        skillButtonContainer.appendChild(button);
    });
}


/**
 * 現在作成中のキャラクターをブラウザの LocalStorage に保存する
 */
function saveCharacter() {
    const newChar = createCharacter();
    if (!newChar) return;
    
    const savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    
    savedChars.push(newChar);
    localStorage.setItem('boardGameCharacters', JSON.stringify(savedChars));
    
    alert(`キャラクター「${newChar.name}」を保存しました。`);
    loadCharacters(); // リストを更新
}

/**
 * LocalStorageからキャラクターリストを読み込み、UIに表示する
 */
function loadCharacters() {
    const savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    const listElement = document.getElementById('saved-character-list');
    listElement.innerHTML = '';
    
    document.getElementById('local-char-count').innerText = 
        `現在 ${savedChars.length} 体のキャラクターがブラウザに保存されています。`;

    if (savedChars.length === 0) {
        listElement.innerHTML = '<li>保存されたキャラクターはいません。</li>';
        return;
    }

    savedChars.forEach(char => {
        const item = document.createElement('li');
        item.innerHTML = `
            <strong>${char.name}</strong> (Lv.${char.level}) 
            STR:${char.stats.STR}, DEX:${char.stats.DEX}, VIT:${char.stats.VIT}, MOVE:${char.stats.MAX_MOVE} 
            <button class="char-select-btn" onclick="selectCharacter(${char.id})">持ち込む</button>
        `;
        listElement.appendChild(item);
    });
}

/**
 * 保存されたキャラクターを選択し、localCharacterとして設定する
 * @param {number} charId - 選択されたキャラクターのID
 */
function selectCharacter(charId) {
    const savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    const selected = savedChars.find(char => char.id === charId);

    if (selected) {
        localCharacter = selected;
        document.getElementById('current-selected-char').innerText = 
            `${selected.name} (Lv.${selected.level}, HP:${selected.stats.MAX_HP}, MOVE:${selected.stats.MAX_MOVE})`;
        alert(`キャラクター「${selected.name}」をゲームに持ち込むキャラクターとして選択しました。`);
        
        updateSkillButtons(selected.skills);
    } else {
        alert('選択されたキャラクターが見つかりません。');
    }
}


// ===================================
// 接続 (WebSocketを想定)
// ===================================

/**
 * ホストとしてゲーム部屋を建てる (参加人数1人でもゲーム開始)
 */
function hostGame() {
    if (!localCharacter) {
        alert('ゲームに持ち込むキャラクターを選択してください。');
        return;
    }

    const enemyLevel = document.getElementById('enemy-level').value;
    isHost = true;
    
    document.getElementById('host-controls').style.display = 'none';
    document.getElementById('join-controls').style.display = 'none';
    document.getElementById('host-info').style.display = 'block';
    document.getElementById('connection-status').innerText = `接続ステータス: ホスト待機中 (敵Lv: ${enemyLevel})`;
    
    connectToServer('ws://localhost:8080'); 
}

/**
 * ホストのIPアドレスを指定してゲームに参加する
 */
function joinGame() {
    if (!localCharacter) {
        alert('ゲームに持ち込むキャラクターを選択してください。');
        return;
    }

    const serverIp = document.getElementById('server-ip').value;
    if (!serverIp) {
        alert('ホストのIPアドレスを入力してください。');
        return;
    }
    isHost = false;
    
    connectToServer(`ws://${serverIp}`);
}

/**
 * WebSocket接続を確立し、イベントを設定する
 * @param {string} url - 接続先のWebSocket URL
 */
function connectToServer(url) {
    if (socket) {
        socket.close();
    }
    
    socket = new WebSocket(url);

    socket.onopen = () => {
        document.getElementById('connection-status').innerText = '接続ステータス: 接続成功！ロビー待機中...';
        
        const message = {
            type: 'PLAYER_JOIN',
            character: localCharacter 
        };
        socket.send(JSON.stringify(message));
        
        // ホストの場合、プレイヤー参加後すぐにゲーム開始信号を送る
        if (isHost) {
            const startMessage = {
                type: 'HOST_START_GAME_IMMEDIATELY',
                enemyLevel: document.getElementById('enemy-level').value
            };
            socket.send(JSON.stringify(startMessage));
        }
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };

    socket.onclose = () => {
        document.getElementById('connection-status').innerText = '接続ステータス: サーバーとの接続が切断されました。';
        document.getElementById('game-board-section').classList.add('hidden');
        document.getElementById('lobby-section').classList.remove('hidden');
        gameState = null;
        currentUnit = null;
    };

    socket.onerror = (error) => {
        document.getElementById('connection-status').innerText = '接続ステータス: 接続エラーが発生しました。';
        console.error('WebSocket Error:', error);
    };
}

/**
 * サーバーから受信したメッセージを処理する
 * @param {object} message - サーバーからのメッセージオブジェクト
 */
function handleServerMessage(message) {
    // アクティブなアクションがあればリセット
    if (message.type !== 'STATE_UPDATE' && message.type !== 'TURN_CHANGE') {
        clearActionState();
    }

    switch (message.type) {
        case 'PLAYER_LIST_UPDATE':
            updatePlayerList(message.players);
            break;
        case 'GAME_START':
            // ... (UI非表示/表示ロジック) ...
            document.getElementById('character-creation').classList.add('hidden');
            document.getElementById('character-management').classList.add('hidden');
            document.getElementById('lobby-section').classList.add('hidden');
            document.getElementById('game-board-section').classList.remove('hidden');
            gameState = message.initialState;
            initializeBoard(gameState);
            alert('ゲームを開始します！');
            break;
        case 'STATE_UPDATE':
            gameState = message.newState;
            updateBoard(gameState);
            updateGameInfo(gameState);
            break;
        case 'TURN_CHANGE':
            gameState = message.newState; // 最新状態を再度受け取る
            updateBoard(gameState);
            
            const myPlayer = gameState.units.find(u => u.playerId === socket.id);
            if (myPlayer) {
                currentUnit = myPlayer;
            }

            document.getElementById('current-turn').innerText = `現在のターン: ${message.currentPlayerName}`;
            
            if (message.isYourTurn) {
                document.getElementById('action-panel').style.pointerEvents = 'auto';
                document.getElementById('action-message').innerText = '行動を選択してください。';
                updateUnitStatsDisplay();
            } else {
                document.getElementById('action-panel').style.pointerEvents = 'none';
                document.getElementById('action-message').innerText = '相手のターンです。待機中...';
                updateUnitStatsDisplay();
            }
            break;
        case 'ERROR':
            alert(`エラー: ${message.message}`);
            break;
    }
}

// ===================================
// ゲームボードとUI
// ===================================

/**
 * ユニットの現在の移動力などを表示する
 */
function updateUnitStatsDisplay() {
    if (currentUnit) {
        document.getElementById('display-move').textContent = currentUnit.currentMove;
        document.getElementById('display-max-move').textContent = currentUnit.maxMove;
    } else {
        document.getElementById('display-move').textContent = 'N/A';
        document.getElementById('display-max-move').textContent = 'N/A';
    }
}

/**
 * 参加プレイヤーリストを更新する
 * (前回のコードから変更なし)
 */
function updatePlayerList(players) {
    const listElement = document.getElementById('player-list');
    listElement.innerHTML = '';
    players.forEach(p => {
        const item = document.createElement('li');
        item.textContent = `${p.name} (Lv.${p.level}) [${p.isHost ? 'ホスト' : '参加者'}]`;
        listElement.appendChild(item);
    });
}

/**
 * ゲームボードを初期化し、マス目を生成する
 * (前回のコードから変更なし)
 */
function initializeBoard(initialState) {
    const board = document.getElementById('game-board');
    board.innerHTML = ''; 

    board.style.gridTemplateColumns = `repeat(${TILE_SIZE}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${TILE_SIZE}, 1fr)`;

    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.dataset.x = i % TILE_SIZE;
        tile.dataset.y = Math.floor(i / TILE_SIZE);
        tile.onclick = handleTileClick; // クリックイベントを設定
        board.appendChild(tile);
    }

    updateBoard(initialState);
}

/**
 * ボード上のユニット配置を更新する
 * (前回のコードから変更なし)
 */
function updateBoard(newState) {
    document.querySelectorAll('.tile').forEach(tile => {
        tile.innerHTML = '';
        tile.classList.remove('occupied');
        // ハイライトクラスもリセット
        tile.classList.remove('move-range', 'target-range', 'hover-highlight');
        tile.onclick = handleTileClick;
    });

    newState.units.forEach(unit => {
        const tile = document.querySelector(`.tile[data-x="${unit.x}"][data-y="${unit.y}"]`);
        if (tile) {
            tile.classList.add('occupied');
            const unitElement = document.createElement('div');
            unitElement.classList.add(unit.isEnemy ? 'enemy-unit' : 'player-unit');
            unitElement.textContent = unit.initial || unit.name.substring(0, 1);
            unitElement.title = `${unit.name} - HP: ${unit.hp}/${unit.maxHp}`;
            tile.appendChild(unitElement);
        }
    });
}

// ===================================
// プレイヤーアクション (クライアント側UI制御)
// ===================================

/**
 * 移動モードを開始する
 */
function handleMoveAction() {
    if (!currentUnit || currentUnit.currentMove <= 0) {
        document.getElementById('action-message').innerText = '移動力が残っていません。';
        return;
    }
    
    clearActionState(); // 既存のアクションをリセット
    activeAction = 'move';
    document.getElementById('action-message').innerText = `移動先をクリックしてください (移動力: ${currentUnit.currentMove})。`;
    
    // サーバーに移動可能範囲の計算を要求する（簡易のため、ここではクライアント側で計算）
    const range = getMoveRange(currentUnit.x, currentUnit.y, currentUnit.currentMove);
    highlightTiles(range, 'move-range');
}

/**
 * スキルモードを開始する
 * @param {number} skillIndex - localCharacter.skills配列のインデックス
 */
function handleSkillAction(skillIndex) {
    if (!currentUnit) return;
    
    const skill = localCharacter.skills[skillIndex];
    if (!skill) return;
    
    clearActionState(); 
    activeAction = { type: 'skill', skill: skill, index: skillIndex };
    document.getElementById('action-message').innerText = `${skill.name} のターゲットを選択してください。`;
    
    // サーバーに射程計算を要求する（簡易のため、ここではクライアント側で計算）
    const range = getSkillRange(currentUnit.x, currentUnit.y, skill);
    highlightTiles(range, 'target-range');
}

/**
 * タイルクリック時のハンドラ
 * @param {Event} event - クリックイベント
 */
function handleTileClick(event) {
    if (!activeAction || !currentUnit) return;
    
    const targetX = parseInt(event.currentTarget.dataset.x);
    const targetY = parseInt(event.currentTarget.dataset.y);
    
    if (activeAction === 'move') {
        if (event.currentTarget.classList.contains('move-range')) {
            sendMoveRequest(targetX, targetY);
        } else {
            document.getElementById('action-message').innerText = 'そこへは移動できません。';
        }
    } else if (activeAction.type === 'skill') {
        if (event.currentTarget.classList.contains('target-range')) {
            sendSkillRequest(activeAction.index, targetX, targetY);
        } else {
            document.getElementById('action-message').innerText = 'そこはスキルの射程外です。';
        }
    }
}

/**
 * 移動リクエストをサーバーに送信
 */
function sendMoveRequest(x, y) {
    const message = {
        type: 'ACTION_MOVE',
        targetX: x,
        targetY: y
    };
    socket.send(JSON.stringify(message));
    document.getElementById('action-message').innerText = '移動リクエストを送信しました...';
    clearActionState();
}

/**
 * スキルリクエストをサーバーに送信
 */
function sendSkillRequest(skillIndex, x, y) {
    const skill = localCharacter.skills[skillIndex];
    if (!skill) return;

    const message = {
        type: 'ACTION_SKILL',
        skillId: skill.id, 
        targetX: x,
        targetY: y
    };
    socket.send(JSON.stringify(message));
    document.getElementById('action-message').innerText = `${skill.name} の発動リクエストを送信しました...`;
    clearActionState();
}


/**
 * ターンを終了する
 */
function endTurn() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('サーバーに接続されていません。');
        return;
    }
    
    const message = {
        type: 'ACTION_END_TURN'
    };
    socket.send(JSON.stringify(message));
    
    document.getElementById('action-panel').style.pointerEvents = 'none';
    document.getElementById('action-message').innerText = 'ターンを終了しました。相手のターンです。';
    clearActionState();
}

/**
 * 現在のアクションモードとボードのハイライトをリセットする
 */
function clearActionState() {
    activeAction = null;
    document.querySelectorAll('.tile').forEach(tile => {
        tile.classList.remove('move-range', 'target-range', 'hover-highlight');
    });
}

// ===================================
// クライアント側の簡易範囲計算 (サーバーで検証されるべきロジック)
// ===================================

/**
 * 汎用的な距離計算 (マンハッタン距離)
 */
function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * 移動可能範囲を計算する（障害物は無視した簡易版）
 * @returns {Array<object>} {x, y}の配列
 */
function getMoveRange(startX, startY, moveValue) {
    const range = [];
    for (let x = 0; x < TILE_SIZE; x++) {
        for (let y = 0; y < TILE_SIZE; y++) {
            if (manhattanDistance(startX, startY, x, y) <= moveValue) {
                range.push({ x: x, y: y });
            }
        }
    }
    return range;
}

/**
 * スキルの射程範囲を計算する
 * @returns {Array<object>} {x, y}の配列
 */
function getSkillRange(startX, startY, skill) {
    const range = [];
    let effectiveRange = 0;

    if (skill.range_type === 'fixed') {
        effectiveRange = skill.range_value;
    } else if (skill.range_type === 'stat_dependent' && localCharacter) {
        const statValue = localCharacter.stats[skill.range_value];
        // 例: DEX依存の場合、射程 = 2 + DEX / 2
        effectiveRange = 2 + Math.floor(statValue / 2); 
    } else if (skill.range_type === 'move_path') {
        // 突撃系は移動力範囲内全てをターゲットとするが、ここでは簡易的に最大移動力を使う
        effectiveRange = localCharacter.stats.MAX_MOVE; 
    }

    for (let x = 0; x < TILE_SIZE; x++) {
        for (let y = 0; y < TILE_SIZE; y++) {
            if (manhattanDistance(startX, startY, x, y) <= effectiveRange) {
                range.push({ x: x, y: y });
            }
        }
    }
    
    return range;
}

/**
 * 指定された座標のタイルにクラスを付与する
 */
function highlightTiles(coords, className) {
    coords.forEach(coord => {
        const tile = document.querySelector(`.tile[data-x="${coord.x}"][data-y="${coord.y}"]`);
        if (tile) {
            tile.classList.add(className);
        }
    });
}

// ===================================
// 初期化
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    fetchSkills(); 
    loadCharacters();
    updateStatsAllocation(); 

    // ダミーの初期状態データ
    const dummyState = {
        units: [
            { name: "P1", level: 1, hp: 100, maxHp: 100, x: 0, y: 0, isEnemy: false, initial: 'P1' },
            { name: "E", level: 1, hp: 50, maxHp: 50, x: 9, y: 9, isEnemy: true, initial: 'E' }
        ]
    };
    initializeBoard(dummyState);
    document.getElementById('game-board-section').classList.add('hidden');
});