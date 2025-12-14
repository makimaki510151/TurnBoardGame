// ===================================
// 定数と状態管理
// ===================================

const TILE_SIZE = 10;
const ZONE_WIDTH = 3; // 自陣・敵陣の幅
let socket = null;
let localCharacter = null; 
let selectedTeam = null;   
let currentUnit = null;    
let gameState = null;      
let isHost = false;
const MAX_BASE_POINTS = 5; 
const MIN_MOVE_VALUE = 1; // 新規: 移動力の最低値保証
let availableSkills = []; 
let activeAction = null;   

// ===================================
// キャラクター制作・管理
// ===================================

/**
 * skills.jsonからスキルデータを非同期で読み込む (省略)
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
 * 読み込んだスキルデータでセレクタを埋める (省略)
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
 * 選択されたスキルの説明文を更新する (省略)
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
 * 現在のレベルとステータス配分に基づいて残りポイントを更新する (省略)
 */
function updateStatsAllocation() {
    const level = parseInt(document.getElementById('char-level').value) || 1;
    const str = parseInt(document.getElementById('stat-str').value) || 1;
    const dex = parseInt(document.getElementById('stat-dex').value) || 1;
    const vit = parseInt(document.getElementById('stat-vit').value) || 1;
    const int = parseInt(document.getElementById('stat-int').value) || 1;
    const agi = parseInt(document.getElementById('stat-agi').value) || 1;
    const luk = parseInt(document.getElementById('stat-luk').value) || 1;

    const totalAllocatablePoints = MAX_BASE_POINTS + (level - 1) * 3;
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
 * フォーム入力に基づいてキャラクターオブジェクトを生成/更新する
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
    
    if (!skillId1 || skillId1 === skillId2) {
        alert('スキルを正しく選択してください。');
        return null;
    }

    const selectedSkills = [skillId1, skillId2]
        .filter(id => id) 
        .map(id => availableSkills.find(s => s.id === id));
    
    // 最小移動力を MIN_MOVE_VALUE で保証
    const baseMove = Math.max(MIN_MOVE_VALUE, agi + Math.floor(luk / 2)); 
    const editingId = document.getElementById('editing-char-id').value;


    const newChar = {
        id: editingId ? parseInt(editingId) : Date.now(), 
        name: name,
        level: level,
        stats: {
            STR: str, DEX: dex, VIT: vit, INT: int, AGI: agi, LUK: luk,
            MAX_HP: 50 + vit * 10, 
            CURRENT_HP: 50 + vit * 10,
            MAX_MOVE: baseMove,
            CURRENT_MOVE: baseMove, 
        },
        skills: selectedSkills, 
        createdAt: new Date().toISOString()
    };
    
    return newChar;
}

/**
 * 現在作成中のキャラクターをブラウザの LocalStorage に保存/更新し、持ち込みキャラとして選択する (変更なし)
 */
function saveCharacter() {
    const newChar = createCharacter();
    if (!newChar) return;
    
    let savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    const isEditingIndex = savedChars.findIndex(c => c.id === newChar.id);
    
    if (isEditingIndex !== -1) {
        savedChars[isEditingIndex] = newChar;
        alert(`キャラクター「${newChar.name}」を更新しました。`);
    } else {
        savedChars.push(newChar);
        alert(`キャラクター「${newChar.name}」を保存しました。`);
    }

    localStorage.setItem('boardGameCharacters', JSON.stringify(savedChars));
    loadCharacters(); 
    clearCharacterForm(); 

    selectCharacterLocally(newChar.id);
}

/**
 * フォームの内容をクリアし、新規作成モードに戻す (省略)
 */
function clearCharacterForm() {
    document.getElementById('char-name').value = '新キャラ';
    document.getElementById('char-level').value = 1;
    document.getElementById('stat-str').value = 1;
    document.getElementById('stat-dex').value = 1;
    document.getElementById('stat-vit').value = 1;
    document.getElementById('stat-int').value = 1;
    document.getElementById('stat-agi').value = 1;
    document.getElementById('stat-luk').value = 1;
    document.getElementById('char-skill-1').value = '';
    document.getElementById('char-skill-2').value = '';
    document.getElementById('editing-char-id').value = '';
    document.getElementById('save-char-btn').textContent = '💾 作成キャラを保存';
    updateStatsAllocation();
    updateSkillDescription(1);
    updateSkillDescription(2);
}

/**
 * LocalStorageからキャラクターリストを読み込み、UIに表示する (持ち込むボタンを「選択」ボタンに変更)
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
            <div>
                <strong>${char.name}</strong> (Lv.${char.level}) 
                STR:${char.stats.STR}, DEX:${char.stats.DEX}, MOVE:${char.stats.MAX_MOVE}
            </div>
            <div class="char-controls">
                <button class="char-select-btn" onclick="selectCharacterLocally(${char.id})">選択</button>
                <button class="char-edit-btn" onclick="editCharacter(${char.id})">編集</button>
                <button class="char-delete-btn" onclick="deleteCharacter(${char.id})">削除</button>
            </div>
        `;
        listElement.appendChild(item);
    });
    
    if (!localCharacter && savedChars.length > 0) {
        selectCharacterLocally(savedChars[0].id);
    } else if (localCharacter) {
        const currentId = localCharacter.id;
        const exists = savedChars.find(c => c.id === currentId);
        if (exists) {
            selectCharacterLocally(currentId);
        } else {
            localCharacter = null;
            document.getElementById('current-selected-char').innerText = '**未選択**';
        }
    }
}

/**
 * 保存されたキャラクターを選択し、localCharacterとして設定する（ローカル処理のみ）
 */
function selectCharacterLocally(charId) {
    const savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    const selected = savedChars.find(char => char.id === charId);

    if (selected) {
        localCharacter = selected;
        document.getElementById('current-selected-char').innerText = 
            `${selected.name} (Lv.${selected.level}, HP:${selected.stats.MAX_HP}, MOVE:${selected.stats.MAX_MOVE})`;
        
        updateSkillButtons(selected.skills);
        
        document.getElementById('btn-team-a').disabled = false;
        document.getElementById('btn-team-b').disabled = false;
        
        // 接続済みであれば、キャラクター選択の更新をサーバーに通知（再参加扱い）
        if (socket && socket.readyState === WebSocket.OPEN) {
             socket.send(JSON.stringify({
                type: 'UPDATE_CHARACTER',
                character: localCharacter 
            }));
        }
    } else {
        alert('選択されたキャラクターが見つかりません。');
    }
}

/**
 * キャラクター編集のためにフォームにデータをロードする (省略)
 */
function editCharacter(charId) {
    const savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    const char = savedChars.find(c => c.id === charId);

    if (!char) return;
    
    document.getElementById('char-name').value = char.name;
    document.getElementById('char-level').value = char.level;
    document.getElementById('stat-str').value = char.stats.STR;
    document.getElementById('stat-dex').value = char.stats.DEX;
    document.getElementById('stat-vit').value = char.stats.VIT;
    document.getElementById('stat-int').value = char.stats.INT;
    document.getElementById('stat-agi').value = char.stats.AGI;
    document.getElementById('stat-luk').value = char.stats.LUK;
    
    document.getElementById('char-skill-1').value = char.skills[0] ? char.skills[0].id : '';
    document.getElementById('char-skill-2').value = char.skills[1] ? char.skills[1].id : '';

    updateStatsAllocation();
    updateSkillDescription(1);
    updateSkillDescription(2);

    document.getElementById('editing-char-id').value = charId;
    document.getElementById('save-char-btn').textContent = '✅ キャラクターを更新';

    document.getElementById('character-creation').scrollIntoView({ behavior: 'smooth' });
}

/**
 * 保存されたキャラクターを削除する (省略)
 */
function deleteCharacter(charId) {
    if (!confirm('このキャラクターを本当に削除しますか？')) return;
    
    let savedChars = JSON.parse(localStorage.getItem('boardGameCharacters') || '[]');
    savedChars = savedChars.filter(c => c.id !== charId);
    localStorage.setItem('boardGameCharacters', JSON.stringify(savedChars));
    
    if (localCharacter && localCharacter.id === charId) {
        localCharacter = null;
        selectedTeam = null;
        document.getElementById('current-selected-char').innerText = '**未選択**';
        document.getElementById('current-selected-team').innerText = '**チーム未選択**';
    }

    loadCharacters();
    alert('キャラクターを削除しました。');
}

/**
 * 選択されたチームを記録し、サーバーに通知 (省略)
 */
function selectTeam(team) {
    if (!localCharacter) {
        alert('先にゲームに持ち込むキャラクターを選択してください。');
        return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('先にホスト/参加でサーバーに接続してください。');
        return;
    }
    
    selectedTeam = team;
    document.getElementById('current-selected-team').innerText = `チーム: ${team}`;

    document.getElementById('btn-team-a').classList.remove('selected-team');
    document.getElementById('btn-team-b').classList.remove('selected-team');
    document.getElementById(`btn-team-${team.toLowerCase()}`).classList.add('selected-team');
    
    socket.send(JSON.stringify({
        type: 'UPDATE_TEAM',
        team: selectedTeam
    }));
}


// ===================================
// 接続とロビー管理 (変更なし)
// ===================================

function hostGame() {
    if (!localCharacter) {
        alert('ゲームに持ち込むキャラクターを選択してください。');
        return;
    }

    isHost = true;
    connectToServer('ws://localhost:8080'); 
}

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

function startGamePvP() {
    if (!isHost || !socket || socket.readyState !== WebSocket.OPEN) {
        alert('ホストとして接続している必要があります。');
        return;
    }
    
    const startMessage = {
        type: 'HOST_START_GAME_PVP'
    };
    socket.send(JSON.stringify(startMessage));
}

function connectToServer(url) {
    if (socket) {
        socket.close();
    }
    
    socket = new WebSocket(url);

    socket.onopen = () => {
        document.getElementById('connection-status').innerText = '接続ステータス: 接続成功！ロビー待機中...';
        document.getElementById('lobby-state-info').classList.remove('hidden'); 
        
        const message = {
            type: 'PLAYER_JOIN',
            character: localCharacter, 
            team: selectedTeam 
        };
        socket.send(JSON.stringify(message));
        
        if (isHost) {
            document.getElementById('start-game-btn').classList.remove('hidden');
        }
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };

    socket.onclose = () => {
        document.getElementById('connection-status').innerText = '接続ステータス: サーバーとの接続が切断されました。';
        document.getElementById('game-board-section').classList.add('hidden');
        document.getElementById('lobby-state-info').classList.add('hidden'); 
        document.getElementById('start-game-btn').classList.add('hidden');
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
 * バグ修正: 自分のユニットがまだ gameState に存在しない場合の処理を追加
 */
function handleServerMessage(message) {
    if (message.type !== 'STATE_UPDATE' && message.type !== 'TURN_CHANGE') {
        clearActionState();
    }

    switch (message.type) {
        case 'PLAYER_LIST_UPDATE':
            updatePlayerList(message.players);
            break;
        case 'GAME_START':
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
            gameState = message.newState; 
            updateBoard(gameState);
            
            // 【★バグ修正の核心】
            // 自分のユニットIDは `socket.id` (プレイヤーID)と一致しているはず
            const myUnit = gameState.units.find(u => u.playerId === socket.id);
            
            // まだユニットが生成されていない場合（最初のターン変更メッセージだが自分の番ではない等）
            if (!myUnit) {
                 currentUnit = null;
                 // 相手ターンなのでアクションパネルを隠す
                 document.getElementById('action-panel').classList.add('hidden');
                 document.getElementById('current-turn').innerText = `現在のターン: チーム ${message.currentTeam} のターンです。`;
                 document.getElementById('action-message').innerText = `相手チームのターンです。待機中...`;
                 updateUnitStatsDisplay();
                 return;
            }

            currentUnit = myUnit;

            document.getElementById('current-turn').innerText = `現在のターン: チーム ${message.currentTeam} - ${message.currentPlayerName} の行動`;
            
            // 自分のチームのターン、かつ操作対象のユニットが自分のものかチェック
            if (message.currentTeam === selectedTeam && message.currentPlayerId === myUnit.id) {
                document.getElementById('action-panel').classList.remove('hidden'); // パネル表示
                document.getElementById('action-message').innerText = '行動を選択してください。';
            } else {
                document.getElementById('action-panel').classList.add('hidden'); // パネル非表示
                document.getElementById('action-message').innerText = `チーム ${message.currentTeam} のターンです。待機中...`;
            }
            updateUnitStatsDisplay();
            break;
        case 'ERROR':
            alert(`エラー: ${message.message}`);
            break;
    }
}

// ===================================
// ゲームボードとUI
// ===================================

function updateUnitStatsDisplay() {
    if (currentUnit) {
        document.getElementById('display-move').textContent = currentUnit.currentMove;
        document.getElementById('display-max-move').textContent = currentUnit.maxMove;
    } else {
        document.getElementById('display-move').textContent = 'N/A';
        document.getElementById('display-max-move').textContent = 'N/A';
    }
}

function updatePlayerList(players) {
    const listElement = document.getElementById('player-list');
    listElement.innerHTML = '';
    players.forEach(p => {
        const item = document.createElement('li');
        item.textContent = `${p.name} (Lv.${p.level}) [チーム: ${p.team || '未定'}] ${p.isHost ? '(ホスト)' : ''}`;
        listElement.appendChild(item);
    });
}

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
 * ゲームボードを初期化し、マス目を生成する (エリアクラスを追加)
 */
function initializeBoard(initialState) {
    const board = document.getElementById('game-board');
    board.innerHTML = ''; 

    board.style.gridTemplateColumns = `repeat(${TILE_SIZE}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${TILE_SIZE}, 1fr)`;

    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const x = i % TILE_SIZE;
        const y = Math.floor(i / TILE_SIZE);
        
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.dataset.x = x;
        tile.dataset.y = y;
        tile.onclick = handleTileClick; 
        
        // エリアクラスの付与
        if (x < ZONE_WIDTH) {
            tile.classList.add('team-A-zone');
        } else if (x >= TILE_SIZE - ZONE_WIDTH) {
            tile.classList.add('team-B-zone');
        }
        
        board.appendChild(tile);
    }

    updateBoard(initialState);
}

/**
 * ボード上のユニット配置を更新する (省略)
 */
function updateBoard(newState) {
    document.querySelectorAll('.tile').forEach(tile => {
        tile.innerHTML = '';
        tile.classList.remove('occupied', 'move-range', 'target-range', 'hover-highlight');
        tile.onclick = handleTileClick;
    });

    newState.units.forEach(unit => {
        const tile = document.querySelector(`.tile[data-x="${unit.x}"][data-y="${unit.y}"]`);
        if (tile) {
            tile.classList.add('occupied');
            const unitElement = document.createElement('div');
            unitElement.classList.add('unit', `team-${unit.team}`); 
            unitElement.textContent = unit.initial || unit.name.substring(0, 1);
            unitElement.title = `${unit.name} (チーム${unit.team}) - HP: ${unit.hp}/${unit.maxHp}`;
            tile.appendChild(unitElement);
        }
    });
}

function updateGameInfo(newState) {
    // ターン情報、HPバーなどがあればここで更新
}

// ===================================
// プレイヤーアクション (クライアント側UI制御) (変更なし)
// ===================================

function handleMoveAction() {
    if (!currentUnit || currentUnit.currentMove <= 0) {
        document.getElementById('action-message').innerText = '移動力が残っていません。';
        return;
    }
    
    clearActionState(); 
    activeAction = 'move';
    document.getElementById('action-message').innerText = `移動先をクリックしてください (移動力: ${currentUnit.currentMove})。`;
    
    const range = getMoveRange(currentUnit.x, currentUnit.y, currentUnit.currentMove);
    highlightTiles(range, 'move-range');
}

function handleSkillAction(skillIndex) {
    if (!currentUnit) return;
    
    const skill = localCharacter.skills[skillIndex];
    if (!skill) return;
    
    clearActionState(); 
    activeAction = { type: 'skill', skill: skill, index: skillIndex };
    document.getElementById('action-message').innerText = `${skill.name} のターゲットを選択してください。`;
    
    const range = getSkillRange(currentUnit.x, currentUnit.y, skill);
    highlightTiles(range, 'target-range');
}

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

function endTurn() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('サーバーに接続されていません。');
        return;
    }
    
    const message = {
        type: 'ACTION_END_TURN'
    };
    socket.send(JSON.stringify(message));
    
    document.getElementById('action-panel').classList.add('hidden');
    document.getElementById('action-message').innerText = 'ターンを終了しました。相手チームのターンです。';
    clearActionState();
}

function clearActionState() {
    activeAction = null;
    document.querySelectorAll('.tile').forEach(tile => {
        tile.classList.remove('move-range', 'target-range', 'hover-highlight');
    });
}

// ------------------------------------
// クライアント側簡易範囲計算 (変更なし)
// ------------------------------------

function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

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

function getSkillRange(startX, startY, skill) {
    const range = [];
    let effectiveRange = 0;

    if (skill.range_type === 'fixed') {
        effectiveRange = skill.range_value;
    } else if (skill.range_type === 'stat_dependent' && localCharacter) {
        const statValue = localCharacter.stats[skill.range_value];
        effectiveRange = 2 + Math.floor(statValue / 2); 
    } else if (skill.range_type === 'move_path') {
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

function highlightTiles(coords, className) {
    coords.forEach(coord => {
        const tile = document.querySelector(`.tile[data-x="${coord.x}"][data-y="${coord.y}"]`);
        if (tile) {
            tile.classList.add(className);
        }
    });
}


// ===================================
// 初期化 (変更なし)
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    fetchSkills(); 
    loadCharacters();
    updateStatsAllocation(); 

    const dummyState = {
        units: [
            { name: "P1", level: 1, hp: 100, maxHp: 100, x: 0, y: 0, team: 'A', initial: 'P1', playerId: 'dummyA' },
            { name: "P2", level: 1, hp: 50, maxHp: 50, x: 9, y: 9, team: 'B', initial: 'P2', playerId: 'dummyB' }
        ]
    };
    initializeBoard(dummyState);
    document.getElementById('game-board-section').classList.add('hidden');
    clearCharacterForm();
});