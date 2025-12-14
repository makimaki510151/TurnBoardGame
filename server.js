// server.js (Node.js + wsライブラリを想定)

const WebSocket = require('ws');
const fs = require('fs');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

// プレイヤー情報: ws, id, name, characterData, team, isHost, unit
let players = []; 
let gameState = null; 
// ターン管理用: チームAのユニットIDリスト、チームBのユニットIDリスト
let teamUnitsA = []; 
let teamUnitsB = [];
let currentTeamTurn = 'A'; 
let currentUnitIndex = 0; 

let availableSkills = []; 

const TILE_SIZE = 10; 
const ZONE_WIDTH = 3; // 自陣・敵陣の幅

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
                    handlePlayerJoin(ws, data.character, data.team, playerIP);
                    break;
                case 'UPDATE_TEAM':
                    handleTeamUpdate(ws, data.team);
                    break;
                case 'UPDATE_CHARACTER':
                    handleCharacterUpdate(ws, data.character);
                    break;
                case 'HOST_START_GAME_PVP':
                    if (isHostWs(ws)) {
                        startGamePvP();
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
 * プレイヤー参加時の処理 (変更なし)
 */
function handlePlayerJoin(ws, character, team, ip) {
    let player = players.find(p => p.ws === ws);
    const isHost = players.length === 0;

    if (!player) {
        player = {
            ws: ws,
            id: ws.id, 
            name: character.name,
            level: character.level,
            isHost: isHost,
            ip: ip,
            characterData: character,
            team: team,
            unit: null, 
        };
        players.push(player);
    } else {
        player.characterData = character;
        player.team = team;
        player.name = character.name;
        player.level = character.level;
    }

    console.log(`${player.name} (チーム${player.team || '未定'}) が参加しました。ホスト: ${player.isHost}`);
    broadcastPlayerList();
}

/**
 * チーム更新時の処理 (変更なし)
 */
function handleTeamUpdate(ws, team) {
    const player = players.find(p => p.ws === ws);
    if (player) {
        player.team = team;
        console.log(`${player.name} がチーム ${team} に変更しました。`);
        broadcastPlayerList();
    }
}

/**
 * キャラクターデータ更新時の処理 (変更なし)
 */
function handleCharacterUpdate(ws, character) {
    const player = players.find(p => p.ws === ws);
    if (player) {
        player.characterData = character;
        player.name = character.name;
        player.level = character.level;
        console.log(`${player.name} がキャラクターデータを更新しました。`);
        broadcastPlayerList();
    }
}


/**
 * プレイヤーが退出した時の処理 (変更なし)
 */
function handlePlayerLeave(ws) {
    const index = players.findIndex(p => p.ws === ws);
    if (index !== -1) {
        const name = players[index].name;
        
        if (gameState && players[index].unit) {
            const unitId = players[index].unit.id;
            gameState.units = gameState.units.filter(u => u.id !== unitId);
            
            teamUnitsA = teamUnitsA.filter(id => id !== unitId);
            teamUnitsB = teamUnitsB.filter(id => id !== unitId);
            
            if (currentTeamTurn === players[index].team) {
                 moveToNextTurn(); 
            }
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
 * 全員に現在のプレイヤーリストを送信 (変更なし)
 */
function broadcastPlayerList() {
    const playerList = players.map(p => ({
        name: p.name,
        level: p.level,
        isHost: p.isHost,
        team: p.team
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
// ゲームロジック (PVP) (変更なし)
// -----------------------------------

function handleGameAction(ws, data) {
    const player = players.find(p => p.ws === ws);
    const unit = player ? gameState.units.find(u => u.id === player.unit.id) : null;
    
    if (!player || !unit || !gameState) return;

    const currentTeamList = (currentTeamTurn === 'A' ? teamUnitsA : teamUnitsB);
    const currentTurnUnitId = currentTeamList[currentUnitIndex];
    
    if (unit.team !== currentTeamTurn || unit.id !== currentTurnUnitId) {
        ws.send(JSON.stringify({ type: 'ERROR', message: `今はチーム ${currentTeamTurn} の ${gameState.units.find(u => u.id === currentTurnUnitId).name} のターンです。` }));
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
                moveToNextUnit(); 
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

function moveToNextUnit() {
    const currentTeamList = (currentTeamTurn === 'A' ? teamUnitsA : teamUnitsB);
    
    currentUnitIndex++;
    
    if (currentUnitIndex >= currentTeamList.length) {
        moveToNextTeam();
    } else {
        sendTurnChangeMessage();
    }
}

function moveToNextTeam() {
    currentTeamTurn = (currentTeamTurn === 'A' ? 'B' : 'A');
    currentUnitIndex = 0; 
    
    gameState.units.forEach(u => {
        const player = players.find(p => p.unit && p.unit.id === u.id);
        if (player) {
            u.currentMove = player.characterData.stats.MAX_MOVE;
        }
    });

    sendTurnChangeMessage();
}

function sendTurnChangeMessage() {
    const currentTeamList = (currentTeamTurn === 'A' ? teamUnitsA : teamUnitsB);
    
    if (currentTeamList.length === 0) {
        // チームが全滅している場合の処理 (省略)
        if (currentTeamTurn === 'A' && teamUnitsB.length > 0) {
            console.log("チームA全滅、チームBの勝利"); return;
        }
        if (currentTeamTurn === 'B' && teamUnitsA.length > 0) {
            console.log("チームB全滅、チームAの勝利"); return;
        }
        if (teamUnitsA.length === 0 && teamUnitsB.length === 0) {
            console.log("引き分け"); return;
        }
        
        moveToNextTeam(); 
        return;
    }
    
    const currentUnitId = currentTeamList[currentUnitIndex];
    const nextUnit = gameState.units.find(u => u.id === currentUnitId);
    
    if (!nextUnit) {
        moveToNextUnit(); 
        return;
    }

    const turnMessage = {
        type: 'TURN_CHANGE',
        currentTeam: currentTeamTurn,
        currentPlayerId: nextUnit.id,
        currentPlayerName: nextUnit.name,
        newState: gameState
    };

    players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({ 
                ...turnMessage, 
            }));
        }
    });
    
    console.log(`ターン: チーム${currentTeamTurn} - ${nextUnit.name} の行動開始`);
}


function executeMove(unit, targetX, targetY) {
    const distance = manhattanDistance(unit.x, unit.y, targetX, targetY);
    
    if (distance === 0) throw new Error("同じ場所への移動はできません。");
    if (distance > unit.currentMove) throw new Error(`移動力(${unit.currentMove})が不足しています。必要: ${distance}`);
    
    // ターゲットマスに既にユニットがいるかチェック
    const targetOccupied = gameState.units.some(u => u.x === targetX && u.y === targetY);
    if (targetOccupied) throw new Error("移動先に他のユニットがいます。");
    
    unit.x = targetX;
    unit.y = targetY;
    unit.currentMove -= distance;
    
    console.log(`${unit.name} (チーム${unit.team}) が (${unit.x}, ${unit.y}) に移動。残りMOVE: ${unit.currentMove}`);
    return true;
}

function executeSkill(unit, skillId, targetX, targetY) {
    const player = players.find(p => p.unit && p.unit.id === unit.id);
    const skill = availableSkills.find(s => s.id === skillId);
    if (!skill || !player) throw new Error("無効なスキルIDです。");
    
    const stat = player.characterData.stats[skill.stat_dependency];
    let effectiveRange = 0;
    
    if (skill.range_type === 'fixed') {
        effectiveRange = skill.range_value;
    } else if (skill.range_type === 'stat_dependent') {
        effectiveRange = 2 + Math.floor(player.characterData.stats.DEX / 2); 
    }
    
    const distance = manhattanDistance(unit.x, unit.y, targetX, targetY);
    
    if (distance > effectiveRange) throw new Error("射程外です。");
    
    const damageMultiplier = skill.base_multiplier;
    const baseDamage = stat * damageMultiplier; 

    const targets = getUnitsInArea(targetX, targetY, skill.target_shape, skill.range_value);

    targets.forEach(targetUnit => {
        const isEnemy = targetUnit.team !== unit.team; 
        
        if (isEnemy && skill.type !== 'support') { 
            targetUnit.hp = Math.max(0, targetUnit.hp - baseDamage);
        } else if (!isEnemy && skill.type === 'support') {
            targetUnit.hp = Math.min(targetUnit.maxHp, targetUnit.hp + baseDamage);
        }
        
        if (targetUnit.hp <= 0) {
             gameState.units = gameState.units.filter(u => u.id !== targetUnit.id);
             console.log(`${targetUnit.name} (チーム${targetUnit.team}) が戦闘不能になりました。`);
             
             teamUnitsA = teamUnitsA.filter(id => id !== targetUnit.id);
             teamUnitsB = teamUnitsB.filter(id => id !== targetUnit.id);
        }
    });
    
    return true;
}

/**
 * ゲーム開始ロジック (PVP) - 初期配置ロジックを修正
 */
function startGamePvP() {
    if (gameState !== null) {
        console.log("ゲームは既に開始されています。");
        return;
    }
    
    const teamA_players = players.filter(p => p.team === 'A');
    const teamB_players = players.filter(p => p.team === 'B');

    if (teamA_players.length === 0 || teamB_players.length === 0) {
        console.log("両チームにプレイヤーが必要です。");
        players.find(p => p.isHost).ws.send(JSON.stringify({ type: 'ERROR', message: '両チームに最低1人プレイヤーが必要です。' }));
        return;
    }

    const units = [];
    teamUnitsA = [];
    teamUnitsB = [];
    
    const occupiedPositions = [];

    // チームAの初期配置
    const teamA_Zone_X_Max = ZONE_WIDTH - 1;
    teamA_players.forEach(p => {
        const charData = p.characterData;
        const pos = findRandomEmptyPosition(0, teamA_Zone_X_Max, 0, TILE_SIZE - 1, occupiedPositions);
        
        p.unit = {
            id: p.id,
            playerId: p.id, // クライアントの socket.id と一致
            name: p.name,
            level: p.level,
            hp: charData.stats.CURRENT_HP,
            maxHp: charData.stats.MAX_HP,
            currentMove: charData.stats.CURRENT_MOVE,
            maxMove: charData.stats.MAX_MOVE,
            x: pos.x,
            y: pos.y,
            team: 'A',
            initial: p.name.substring(0, 1).toUpperCase()
        };
        units.push(p.unit);
        teamUnitsA.push(p.unit.id);
        occupiedPositions.push(pos);
    });

    // チームBの初期配置
    const teamB_Zone_X_Min = TILE_SIZE - ZONE_WIDTH;
    teamB_players.forEach(p => {
        const charData = p.characterData;
        const pos = findRandomEmptyPosition(teamB_Zone_X_Min, TILE_SIZE - 1, 0, TILE_SIZE - 1, occupiedPositions);
        
        p.unit = {
            id: p.id,
            playerId: p.id, 
            name: p.name,
            level: p.level,
            hp: charData.stats.CURRENT_HP,
            maxHp: charData.stats.MAX_HP,
            currentMove: charData.stats.CURRENT_MOVE,
            maxMove: charData.stats.MAX_MOVE,
            x: pos.x,
            y: pos.y,
            team: 'B',
            initial: p.name.substring(0, 1).toUpperCase()
        };
        units.push(p.unit);
        teamUnitsB.push(p.unit.id);
        occupiedPositions.push(pos);
    });
    
    gameState = {
        boardSize: TILE_SIZE,
        units: units,
        log: []
    };
    
    currentTeamTurn = 'A';
    currentUnitIndex = -1; 
    
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
    moveToNextUnit();
}

// -----------------------------------
// ユーティリティ
// -----------------------------------

function manhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function getUnitsInArea(centerX, centerY, targetShape, rangeValue) {
    // 省略
    // ...
    // ...
}

/**
 * 指定されたゾーン内で空いているランダムな位置を見つける
 * @param {number} xMin - ゾーンのX座標最小値
 * @param {number} xMax - ゾーンのX座標最大値
 * @param {number} yMin - ゾーンのY座標最小値
 * @param {number} yMax - ゾーンのY座標最大値
 * @param {Array<{x: number, y: number}>} occupiedPositions - 既に占有されている位置のリスト
 * @returns {{x: number, y: number} | null} - 空き位置、またはゾーンに空きがない場合は null
 */
function findRandomEmptyPosition(xMin, xMax, yMin, yMax, occupiedPositions) {
    const zonePositions = [];
    for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
            zonePositions.push({ x: x, y: y });
        }
    }

    // 既に占有されている位置を除外
    const emptyPositions = zonePositions.filter(pos => 
        !occupiedPositions.some(occ => occ.x === pos.x && occ.y === pos.y)
    );

    if (emptyPositions.length === 0) {
        console.error(`ERROR: 指定されたゾーン (${xMin}, ${yMin}) to (${xMax}, ${yMax}) に空きがありません。`);
        return { x: xMin, y: yMin }; // エラー回避のためゾーンの角を返す
    }

    // ランダムに選択
    const randomIndex = Math.floor(Math.random() * emptyPositions.length);
    return emptyPositions[randomIndex];
}