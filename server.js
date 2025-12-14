// server.js (Node.js + wsライブラリを想定)

/*
以下のコマンドで必要なライブラリをインストールしてください:
npm init -y
npm install ws
*/

const WebSocket = require('ws');

// ポート番号は適宜変更してください
const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

let players = []; // 接続中のプレイヤーとキャラデータ
let enemyLevel = 1;
let gameState = {}; // ゲームの全体状態 (盤面、ターン、ユニット情報など)
let turnOrder = [];
let currentTurnIndex = 0;

console.log(`WebSocketサーバーをポート ${PORT} で起動しました。`);

wss.on('connection', function connection(ws, req) {
    const playerIP = req.socket.remoteAddress;
    console.log(`新しい接続: ${playerIP}`);

    ws.on('message', function incoming(message) {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'PLAYER_JOIN':
                handlePlayerJoin(ws, data.character, playerIP);
                break;
            case 'ACTION_MOVE':
            case 'ACTION_SKILL':
            case 'ACTION_END_TURN':
                handleGameAction(ws, data);
                break;
            default:
                console.log('不明なメッセージタイプ:', data.type);
        }
    });

    ws.on('close', () => {
        handlePlayerLeave(ws);
    });
});

/**
 * プレイヤー参加時の処理
 */
function handlePlayerJoin(ws, character, ip) {
    const isHost = players.length === 0; // 最初の接続者をホストとする
    const newPlayer = {
        ws: ws,
        id: players.length + 1,
        name: character.name,
        level: character.level,
        isHost: isHost,
        ip: ip,
        characterData: character,
    };
    players.push(newPlayer);
    
    console.log(`${newPlayer.name} が参加しました。ホスト: ${newPlayer.isHost}`);

    // 全員にプレイヤーリストをブロードキャスト
    broadcastPlayerList();
    
    // ホストであれば、敵レベルをセット (簡易実装)
    if (newPlayer.isHost) {
        enemyLevel = 1; // 実際はホストが指定した値を使用
    }

    // ゲーム開始の判定 (例: 参加者が2人以上になったらホストが開始ボタンを押せる)
}

/**
 * プレイヤーが退出した時の処理
 */
function handlePlayerLeave(ws) {
    const index = players.findIndex(p => p.ws === ws);
    if (index !== -1) {
        const name = players[index].name;
        players.splice(index, 1);
        console.log(`${name} が退出しました。`);
        broadcastPlayerList();
    }
    // ホストが退出した場合、ゲームを終了させる処理が必要
}

/**
 * 全員に現在のプレイヤーリストを送信
 */
function broadcastPlayerList() {
    const playerList = players.map(p => ({
        name: p.name,
        level: p.level,
        isHost: p.isHost
    }));

    const message = JSON.stringify({
        type: 'PLAYER_LIST_UPDATE',
        players: playerList
    });

    players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(message);
        }
    });
}

/**
 * プレイヤーのゲームアクションを処理
 */
function handleGameAction(ws, data) {
    const player = players.find(p => p.ws === ws);
    if (!player) return;

    // ターンチェック
    if (turnOrder[currentTurnIndex] !== player.id) {
        // プレイヤーのターンではない
        ws.send(JSON.stringify({ type: 'ERROR', message: '今はあなたのターンではありません。' }));
        return;
    }
    
    // ゲームロジックを実行し、gameStateを更新
    let success = false;

    switch (data.type) {
        case 'ACTION_MOVE':
            // 移動処理ロジック (移動可能範囲のチェック、座標更新など)
            console.log(`${player.name} が (${data.targetX}, ${data.targetY}) に移動を試行`);
            // ... (ロジック)
            success = true;
            break;
        case 'ACTION_SKILL':
            // スキル処理ロジック (射程チェック、ダメージ計算など)
            // ... (ロジック)
            success = true;
            break;
        case 'ACTION_END_TURN':
            // ターン終了
            moveToNextTurn();
            return; // ターン終了はgameState更新とは別に処理
    }

    if (success) {
        // 全員に更新されたゲーム状態をブロードキャスト
        broadcastGameStateUpdate();
    }
}

/**
 * 次のプレイヤーまたはNPCのターンへ移行
 */
function moveToNextTurn() {
    // ターン順: プレイヤーA -> 敵 -> プレイヤーB -> 敵 ...
    
    // ... ターンインデックスの更新ロジック ...

    // 次のターン開始を全員に通知
    const currentPlayerId = turnOrder[currentTurnIndex];
    const nextPlayer = players.find(p => p.id === currentPlayerId);
    
    if (nextPlayer) {
        const turnMessage = {
            type: 'TURN_CHANGE',
            currentPlayerName: nextPlayer.name,
            // 誰のターンかを判定するための情報
        };

        players.forEach(p => {
            p.ws.send(JSON.stringify({ 
                ...turnMessage, 
                isYourTurn: (p.id === nextPlayer.id) 
            }));
        });
    } else {
        // NPC (敵) のターン処理
        handleNpcTurn();
    }
}

// 簡易的な状態ブロードキャスト
function broadcastGameStateUpdate() {
    const updateMessage = JSON.stringify({
        type: 'STATE_UPDATE',
        newState: gameState // 更新された状態
    });

    players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(updateMessage);
        }
    });
}

// 【補足】NPCの行動ロジックの実装も必要
function handleNpcTurn() {
    // ... NPCの移動、スキル選択、攻撃ロジック ...
    // 行動後、gameStateを更新し、moveToNextTurn()を再度呼び出す
    
    // 敵の行動後、ブロードキャスト
    broadcastGameStateUpdate();
    
    // 次のターンへ
    moveToNextTurn(); 
}

// ... ゲーム開始ロジック (turnOrderとgameStateの初期化) ...
function startGame() {
    // プレイヤーとNPCを混ぜたターン順を決定
    // gameStateにボード、ユニットの初期配置などを設定
    broadcastGameStateUpdate();
    moveToNextTurn();
}