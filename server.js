// server.js (Node.js + wsライブラリを想定)
// 【注意】本ファイルはクライアントのブラウザ上ではなく、ホスト側のNode.js環境で動作させます。

const WebSocket = require('ws');
const fs = require('fs');

// ポート番号は適宜変更してください
const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

let players = []; // 接続中のプレイヤーとキャラデータ (ws, id, name, characterData, unit)
let enemyLevel = 1;
let gameState = null; // ゲームの全体状態 (boardSize, units, log)
let turnOrder = [];
let currentTurnIndex = 0;
let availableSkills = []; // スキルデータをロード

const TILE_SIZE = 10; 

console.log(`WebSocketサーバーをポート ${PORT} で起動しました。`);

// skills.jsonを同期的に読み込み（サーバー起動時）
try {
    const skillData = fs.readFileSync('skills.json', 'utf8');
    availableSkills = JSON.parse(skillData);
    console.log(`スキルデータ ${availableSkills.length} 件をロードしました。`);
} catch (e) {
    console.error("skills.jsonの読み込みまたはパースに失敗しました。サーバーを終了します。", e);
    process.exit(1);
}

wss.on('connection', function connection(ws, req) {
    ws.id = Math.random().toString(36).substring(2, 9);
    const playerIP = req.socket.remoteAddress;
    console.log(`新しい接続: ${playerIP} (ID: ${ws.id})`);

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'PLAYER_JOIN':
                    handlePlayerJoin(ws, data.character, playerIP);
                    break;
                case 'HOST_START_GAME_IMMEDIATELY':
                    if (isHostWs(ws)) {
                        enemyLevel = data.enemyLevel || 1;
                        startGame();
                    }
                    break;
                case 'ACTION_MOVE':
                case 'ACTION_SKILL':
                case 'ACTION_END_TURN':
                    handleGameAction(ws, data);
                    break;
                default:
                    console.log('不明なメッセージタイプ:', data.type);
            }
        } catch (e) {
            console.error("メッセージ処理エラー:", e);
        }
    });

    ws.on('close', () => {
        handlePlayerLeave(ws);
    });
});

function isHostWs(ws) {
    const host = players.find(p => p.isHost);
    return host && host.ws === ws;
}

/**
 * プレイヤー参加時の処理
 */
function handlePlayerJoin(ws, character, ip) {
    const isHost = players.length === 0; 
    
    // プレイヤーユニットIDはws.idを使用し、ユニットとプレイヤーを紐づける
    const newPlayer = {
        ws: ws,
        id: ws.id, 
        name: character.name,
        level: character.level,
        isHost: isHost,
        ip: ip,
        characterData: character,
        unit: null, 
    };
    players.push(newPlayer);
    
    console.log(`${newPlayer.name} が参加しました。ホスト: ${newPlayer.isHost}`);

    broadcastPlayerList();
}

/**
 * プレイヤーが退出した時の処理
 */
function handlePlayerLeave(ws) {
    const index = players.findIndex(p => p.ws === ws);
    if (index !== -1) {
        const name = players[index].name;
        
        // ユニットを盤面から削除 (ゲーム中の場合)
        if (gameState && players[index].unit) {
            gameState.units = gameState.units.filter(u => u.id !== players[index].unit.id);
            // ターン順からも削除
            turnOrder = turnOrder.filter(id => id !== players[index].unit.id);
            // ターンインデックスの調整が必要だが、ここでは簡易化
            broadcastGameStateUpdate();
        }
        
        players.splice(index, 1);
        console.log(`${name} が退出しました。`);
        broadcastPlayerList();
        
        if (gameState && !players.some(p => p.isHost)) {
            console.log("ホストが退出しました。ゲームを終了します。");
            gameState = null;
        }
    }
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

// -----------------------------------
// ゲームロジック
// -----------------------------------

/**
 * プレイヤーのゲームアクションを処理
 */
function handleGameAction(ws, data) {
    const player = players.find(p => p.ws === ws);
    const unit = player ? gameState.units.find(u => u.id === player.unit.id) : null;
    
    if (!player || !unit || !gameState) return;

    // ターンチェック
    if (turnOrder[currentTurnIndex] !== unit.id) {
        ws.send(JSON.stringify({ type: 'ERROR', message: '今はあなたのターンではありません。' }));
        return;
    }
    
    let success = false;

    try {
        switch (data.type) {
            case 'ACTION_MOVE':
                success = executeMove(unit, data.targetX, data.targetY);
                break;
            case 'ACTION_SKILL':
                success = executeSkill(unit, data.skillId, data.targetX, data.targetY);
                break;
            case 'ACTION_END_TURN':
                // ターン終了
                moveToNextTurn();
                return; 
        }
    } catch (error) {
        ws.send(JSON.stringify({ type: 'ERROR', message: `行動失敗: ${error.message}` }));
        console.error("行動実行エラー:", error.message);
        return;
    }

    if (success) {
        broadcastGameStateUpdate();
    } else {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'その行動は無効です。' }));
    }
}

/**
 * 移動アクションを実行
 */
function executeMove(unit, targetX, targetY) {
    const distance = manhattanDistance(unit.x, unit.y, targetX, targetY);
    
    if (distance === 0) return false; // 同じ場所
    if (distance > unit.currentMove) return false; // 移動力不足
    
    // ターゲットマスに既にユニットがいるかチェック (簡易版: 障害物チェックは省略)
    const targetOccupied = gameState.units.some(u => u.x === targetX && u.y === targetY);
    if (targetOccupied) return false; 
    
    // 移動を適用し、移動力を消費
    unit.x = targetX;
    unit.y = targetY;
    unit.currentMove -= distance;
    
    console.log(`${unit.name} が (${unit.x}, ${unit.y}) に移動。残りMOVE: ${unit.currentMove}`);
    return true;
}

/**
 * スキルアクションを実行
 */
function executeSkill(unit, skillId, targetX, targetY) {
    const skill = availableSkills.find(s => s.id === skillId);
    if (!skill) throw new Error("無効なスキルIDです。");
    
    // 1. コストチェック (ここでは簡易的にコストなしと仮定)
    // if (unit.currentMP < skill.cost) throw new Error("MPが不足しています。");

    // 2. 射程チェック (簡易版: 射程範囲内かのみチェック)
    const stat = unit.characterData.stats[skill.stat_dependency];
    let effectiveRange = 0;
    
    if (skill.range_type === 'fixed') {
        effectiveRange = skill.range_value;
    } else if (skill.range_type === 'stat_dependent') {
        // クライアントと同じ計算式を使用
        effectiveRange = 2 + Math.floor(unit.characterData.stats.DEX / 2); 
    }
    
    const distance = manhattanDistance(unit.x, unit.y, targetX, targetY);
    
    if (distance > effectiveRange) throw new Error("射程外です。");
    
    // 3. ターゲットと効果の適用
    const damageMultiplier = skill.base_multiplier;
    const baseDamage = stat * damageMultiplier; 

    // ターゲット形状に基づき、影響を受けるユニットを検索
    const targets = getUnitsInArea(targetX, targetY, skill.target_shape, skill.range_value);

    targets.forEach(targetUnit => {
        if (targetUnit.isEnemy !== unit.isEnemy) { // 敵であればダメージ、味方であれば回復など（簡易処理）
            targetUnit.hp = Math.max(0, targetUnit.hp - baseDamage);
            console.log(`${unit.name} が ${targetUnit.name} に ${baseDamage.toFixed(1)} ダメージ！`);
        }
    });
    
    // コストを消費
    // unit.currentMP -= skill.cost;
    
    return true;
}

/**
 * ターンを次のプレイヤーまたはNPCへ移行
 */
function moveToNextTurn() {
    // ターン順をインクリメント
    currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
    const currentPlayerId = turnOrder[currentTurnIndex];
    
    // ターンが移る前に、移動力をリセット
    gameState.units.forEach(u => {
        const player = players.find(p => p.unit && p.unit.id === u.id);
        if (player) {
            u.currentMove = player.characterData.stats.MAX_MOVE;
        }
        // NPCのMOVEもここでリセット可能
    });
    
    const nextUnit = gameState.units.find(u => u.id === currentPlayerId);
    
    if (nextUnit && !nextUnit.isEnemy) {
        // プレイヤーのターン
        const nextPlayer = players.find(p => p.unit && p.unit.id === nextUnit.id);

        const turnMessage = {
            type: 'TURN_CHANGE',
            currentPlayerName: nextUnit.name,
            newState: gameState // 最新の状態を送信
        };

        players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) {
                 p.ws.send(JSON.stringify({ 
                    ...turnMessage, 
                    isYourTurn: (p.id === nextPlayer.id) 
                }));
            }
        });
    } else {
        // NPC (敵) のターン処理
        handleNpcTurn();
    }
}

/**
 * ゲーム状態のブロードキャスト
 */
function broadcastGameStateUpdate() {
    const updateMessage = JSON.stringify({
        type: 'STATE_UPDATE',
        newState: gameState 
    });

    players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(updateMessage);
        }
    });
}

/**
 * NPC（敵）の行動ロジック処理 (簡易版)
 */
function handleNpcTurn() {
    console.log("NPCのターン開始");
    
    const npcUnit = gameState.units.find(u => u.isEnemy && u.id === turnOrder[currentTurnIndex]);
    if (npcUnit) {
        // 【簡易NPCロジック】: 最も近いプレイヤーユニットに向かって移動
        const targetPlayer = gameState.units.filter(u => !u.isEnemy).sort((a, b) => {
            return manhattanDistance(npcUnit.x, npcUnit.y, a.x, a.y) - manhattanDistance(npcUnit.x, npcUnit.y, b.x, b.y);
        })[0];

        if (targetPlayer) {
            // 移動処理のシミュレーション
            const dx = targetPlayer.x - npcUnit.x;
            const dy = targetPlayer.y - npcUnit.y;
            
            let moveAmount = npcUnit.currentMove;
            
            // ターゲットに近づく方向へ1マス移動 (簡易)
            let newX = npcUnit.x;
            let newY = npcUnit.y;
            
            if (Math.abs(dx) > Math.abs(dy)) {
                newX += (dx > 0 ? 1 : -1);
            } else if (dy !== 0) {
                newY += (dy > 0 ? 1 : -1);
            }

            if (executeMove(npcUnit, newX, newY)) {
                console.log(`NPCが (${newX}, ${newY}) へ移動`);
            } else {
                // 移動できなければ攻撃を試みる
                // executeSkill(npcUnit, some_skill_id, targetPlayer.x, targetPlayer.y);
            }
        }
    }
    
    broadcastGameStateUpdate();
    
    // ターン終了
    moveToNextTurn(); 
}

/**
 * ゲーム開始ロジック
 */
function startGame() {
    if (gameState !== null) {
        console.log("ゲームは既に開始されています。");
        return;
    }
    
    console.log(`ゲーム開始！敵レベル: ${enemyLevel}、参加プレイヤー数: ${players.length}`);

    const units = [];
    turnOrder = [];
    
    // プレイヤーユニットの配置と初期化
    players.forEach((p, index) => {
        const charData = p.characterData;
        const x = 0; 
        const y = index; 
        
        p.unit = {
            id: p.id,
            playerId: p.id, // プレイヤーIDを保持
            name: p.name,
            level: p.level,
            hp: charData.stats.CURRENT_HP,
            maxHp: charData.stats.MAX_HP,
            currentMove: charData.stats.CURRENT_MOVE,
            maxMove: charData.stats.MAX_MOVE,
            x: x,
            y: y,
            isEnemy: false,
            initial: p.name.substring(0, 1).toUpperCase()
        };
        units.push(p.unit);
        turnOrder.push(p.unit.id); 
    });

    // NPCユニットの配置
    const npcUnit = {
        id: 'npc-e-1',
        name: `敵Lv${enemyLevel}`,
        level: parseInt(enemyLevel),
        hp: 30 + parseInt(enemyLevel) * 20,
        maxHp: 30 + parseInt(enemyLevel) * 20,
        currentMove: 3,
        maxMove: 3,
        x: TILE_SIZE - 1, 
        y: TILE_SIZE - 1,
        isEnemy: true,
        initial: 'E'
    };
    units.push(npcUnit);
    turnOrder.push(npcUnit.id); 

    // ターン順はここでは [P1, P2, NPC] の順だが、後でシャッフルや交互にするロジックが必要
    
    gameState = {
        boardSize: TILE_SIZE,
        units: units,
        log: []
    };
    
    currentTurnIndex = -1; // moveToNextTurnで0になるように
    
    const startMessage = JSON.stringify({
        type: 'GAME_START',
        initialState: gameState
    });

    players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(startMessage);
        }
    });

    // 最初のターンを開始
    moveToNextTurn();
}

// -----------------------------------
// ユーティリティ
// -----------------------------------

/**
 * 汎用的な距離計算 (マンハッタン距離)
 */
function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * 指定されたエリア内のユニットを返す（簡易形状処理）
 */
function getUnitsInArea(centerX, centerY, targetShape, rangeValue) {
    const affectedTiles = [];
    
    // スキルのターゲット形状に基づいて影響範囲を計算
    if (targetShape === 'single') {
        affectedTiles.push({ x: centerX, y: centerY });
    } else if (targetShape === 'cross') {
        // 例: rangeValueを半径と見立てる（ここでは固定の十字3x3を適用）
        const radius = 1; 
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let y = centerY - radius; y <= centerY + radius; y++) {
                if ((Math.abs(x - centerX) === 0 || Math.abs(y - centerY) === 0) && 
                    x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) {
                    affectedTiles.push({ x: x, y: y });
                }
            }
        }
    }
    
    const affectedUnits = gameState.units.filter(unit => {
        return affectedTiles.some(tile => tile.x === unit.x && tile.y === unit.y);
    });

    return affectedUnits;
}