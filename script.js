// ===================================
// 定数と状態管理
// ===================================

const TILE_SIZE = 10; // ボードのサイズ (10x10マスを想定)
let socket = null;
let localCharacter = null;
let isHost = false;

// ===================================
// キャラクター管理
// ===================================

/**
 * 事前に作成したキャラクターデータをインポートする
 */
function importCharacter() {
    const dataInput = document.getElementById('character-data-input').value;
    try {
        const charData = JSON.parse(dataInput);
        
        // データのバリデーション（簡易的）
        if (!charData.name || !charData.stats || !charData.skills) {
            alert('キャラクターデータの形式が不正です。');
            return;
        }

        localCharacter = charData;
        document.getElementById('character-status-display').innerText = 
            `**キャラクターロード完了:** ${charData.name} (Lv.${charData.level})\n` + 
            `STR: ${charData.stats.STR}, DEX: ${charData.stats.DEX}, VIT: ${charData.stats.VIT}`;
        alert('キャラクターをロードしました。');

    } catch (e) {
        alert('無効なJSON形式です。正しいデータをペーストしてください。');
        console.error(e);
    }
}


// ===================================
// 接続 (WebSocketを想定)
// ===================================

/**
 * ホストとしてゲーム部屋を建てる
 */
function hostGame() {
    if (!localCharacter) {
        alert('先にキャラクターをロードしてください。');
        return;
    }

    // サーバーサイド(server.js)でWebSocketサーバーを起動させる必要があります。
    // ここでは、クライアント側は自身のPCのIPアドレスとポートを他のプレイヤーに通知する役割のみ行います。

    const enemyLevel = document.getElementById('enemy-level').value;
    isHost = true;
    
    // 【重要】サーバーサイド処理：
    // 実際には、Node.jsなどでWebSocketサーバーを起動し、
    // 敵レベル情報とホストのキャラデータを保持します。

    // ロビー画面表示の更新
    document.getElementById('host-controls').style.display = 'none';
    document.getElementById('join-controls').style.display = 'none';
    document.getElementById('host-info').style.display = 'block';
    document.getElementById('connection-status').innerText = `接続ステータス: ホスト待機中 (敵Lv: ${enemyLevel})`;
    
    // 参加者の接続を待つ処理...
    // 【補足】ホスト自身も、localhost/127.0.0.1で自身のサーバーに接続することが必要になる場合があります。
    
    // 実際はサーバー起動が成功した後に、以下のWebSocket接続を行います
    connectToServer('ws://localhost:8080'); 
    
    // 参加者リストの更新はサーバーからのメッセージによって行われます
}

/**
 * ホストのIPアドレスを指定してゲームに参加する
 */
function joinGame() {
    if (!localCharacter) {
        alert('先にキャラクターをロードしてください。');
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
        
        // 接続成功時、キャラクターデータをサーバーに送信
        const message = {
            type: 'PLAYER_JOIN',
            character: localCharacter
        };
        socket.send(JSON.stringify(message));
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };

    socket.onclose = () => {
        document.getElementById('connection-status').innerText = '接続ステータス: サーバーとの接続が切断されました。';
        // UIをロビーに戻す処理などを追加
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
    switch (message.type) {
        case 'PLAYER_LIST_UPDATE':
            updatePlayerList(message.players);
            break;
        case 'GAME_START':
            // サーバーからゲーム開始の合図が来たらボードを表示
            document.getElementById('lobby-section').classList.add('hidden');
            document.getElementById('game-board-section').classList.remove('hidden');
            initializeBoard(message.initialState);
            break;
        case 'STATE_UPDATE':
            // ゲーム状態の更新 (ユニットの位置、HPなど)
            updateBoard(message.newState);
            updateGameInfo(message.newState);
            break;
        case 'TURN_CHANGE':
            document.getElementById('current-turn').innerText = `現在のターン: ${message.currentPlayerName}`;
            // 自分のターンであれば行動パネルを有効化
            if (message.isYourTurn) {
                document.getElementById('action-panel').style.pointerEvents = 'auto';
                document.getElementById('action-message').innerText = '行動を選択してください。';
            } else {
                document.getElementById('action-panel').style.pointerEvents = 'none';
                document.getElementById('action-message').innerText = '相手のターンです。待機中...';
            }
            break;
        // その他のメッセージ（チャット、ゲーム終了など）
    }
}

// ===================================
// ゲームボードとUI
// ===================================

/**
 * 参加プレイヤーリストを更新する
 * @param {Array<object>} players - プレイヤー情報の配列
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
 * @param {object} initialState - ゲームの初期状態データ
 */
function initializeBoard(initialState) {
    const board = document.getElementById('game-board');
    board.innerHTML = ''; // ボードをクリア

    // ボードのサイズを設定
    board.style.gridTemplateColumns = `repeat(${TILE_SIZE}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${TILE_SIZE}, 1fr)`;

    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.dataset.x = i % TILE_SIZE;
        tile.dataset.y = Math.floor(i / TILE_SIZE);
        board.appendChild(tile);
    }

    updateBoard(initialState);
}

/**
 * ボード上のユニット配置を更新する
 * @param {object} newState - ゲームの最新状態データ
 */
function updateBoard(newState) {
    // 全てのユニットを一旦クリア
    document.querySelectorAll('.tile').forEach(tile => {
        tile.innerHTML = '';
        tile.classList.remove('occupied');
    });

    // プレイヤーユニットの配置
    newState.units.forEach(unit => {
        const tile = document.querySelector(`.tile[data-x="${unit.x}"][data-y="${unit.y}"]`);
        if (tile) {
            tile.classList.add('occupied');
            const unitElement = document.createElement('div');
            unitElement.classList.add(unit.isEnemy ? 'enemy-unit' : 'player-unit');
            unitElement.textContent = unit.initial || 'U'; // ユニットのイニシャルなど
            unitElement.title = `${unit.name} - HP: ${unit.hp}`;
            tile.appendChild(unitElement);
        }
    });
}

/**
 * ゲーム情報を更新する (ターン、メッセージなど)
 * @param {object} newState - ゲームの最新状態データ
 */
function updateGameInfo(newState) {
    // ターン情報、HPバーなどがあればここで更新
    // 例: 自分のユニットのHP表示を更新
}

// ===================================
// プレイヤーアクション
// ===================================

/**
 * 移動アクションを開始（移動先のマスを選択可能にする）
 */
function moveCharacter() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('サーバーに接続されていません。');
        return;
    }
    
    document.getElementById('action-message').innerText = '移動したいマスをクリックしてください。';
    // 実際には、移動可能範囲をハイライト表示する処理が必要

    // ボードのクリックイベントを設定 (移動先選択)
    document.querySelectorAll('.tile').forEach(tile => {
        tile.onclick = (event) => {
            const targetX = parseInt(event.currentTarget.dataset.x);
            const targetY = parseInt(event.currentTarget.dataset.y);
            
            // サーバーに移動リクエストを送信
            const message = {
                type: 'ACTION_MOVE',
                targetX: targetX,
                targetY: targetY
            };
            socket.send(JSON.stringify(message));
            
            // アクション完了後、クリックイベントを解除
            document.querySelectorAll('.tile').forEach(t => t.onclick = null);
            document.getElementById('action-message').innerText = 'サーバーからの応答を待っています...';
        };
    });
}

/**
 * スキルを発動する
 * @param {number} skillId - 発動するスキルのID
 */
function useSkill(skillId) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('サーバーに接続されていません。');
        return;
    }
    
    // スキルに応じたターゲット選択処理 (移動と同様のクリックイベント設定など)
    
    const message = {
        type: 'ACTION_SKILL',
        skillId: skillId,
        // target: ... (ターゲットマスやユニットのIDなど)
    };
    socket.send(JSON.stringify(message));
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
    
    // ターン終了ボタンを無効化
    document.getElementById('action-panel').style.pointerEvents = 'none';
    document.getElementById('action-message').innerText = 'ターンを終了しました。相手のターンです。';
}

// 初期化時にボードの雛形を生成 (ロビー表示時に非表示にしておく)
document.addEventListener('DOMContentLoaded', () => {
    // ダミーの初期状態データ
    const dummyState = {
        units: [
            { name: "Player1", level: 1, hp: 100, x: 0, y: 0, isEnemy: false, initial: 'P1' },
            { name: "Enemy", level: 1, hp: 50, x: 9, y: 9, isEnemy: true, initial: 'E' }
        ]
    };
    initializeBoard(dummyState);
    document.getElementById('game-board-section').classList.add('hidden');
});

// イメージ図のトリガー
// ゲームボードのマス目の様子がわかる図があると、より分かりやすくなります。
//