(() => {
  'use strict';

  const CONFIG = {
    pxPerCm: 120,
    regionRadiusCm: 2.5,
    rotateStepDeg: 15,
    snap: {
      edgeDistCm: 0.08,
      edgeAngleDeg: 8,
      edgeOverlapCm: 0.15,
      vertexDistCm: 0.08,
      vertexSumDeg: 6,
      collisionEpsCm: 0.02,
      dragStepCm: 0.1,
      maxAssistCm: 0.5
    },
    region: {
      arcSegments: 14
    },
    arcSampleDeg: 10,
    wheelRotationDeg: 5,
    neutralTileLimitPerPlayer: 1,
    playerColors: ['#f15d5d', '#4f8ef7', '#3fbf7f', '#f2b84b'],
    boardDefs: {}, tileDefs: {}, tileCounts: {}, obstacleDefs: {}, obstacleCounts: {}
  };

  const state = {
    phase: 'idle',
    boardType: 'square',
    mode: 'classic',
    playerCount: 4,
    startPlayerIndex: 0,
    board: null,
    assetsReady: false,
    assets: { boards: {}, tiles: {}, obstacles: {} },
    availableTiles: [],
    availableObstacles: [],
    assetErrors: [],
    players: [],
    turnOrder: [],
    turnPointer: 0,
    passStreak: 0,
    endSummary: '',
    actionUsed: false,
    placingTileTypeId: null,
    placingNeutral: false,
    selectedObstacleTypeId: null,
    selected: null,
    dragging: null,
    tiles: [],
    obstacles: [],
    connections: new Map(),
    tileToGroup: new Map(),
    setupStep: 'idle',
    regionSelectIndex: 0,
    regionOrder: [],
    obstaclePool: {},
    view: { scale: CONFIG.pxPerCm, offset: { x: 0, y: 0 }, dpr: 1 }
  };

  const ui = {};
  let idCounter = 1;

  window.addEventListener('load', init);

  function init() {
    cacheUi();
    bindUi();
    updateStartPlayerOptions();
    updateUiState();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setStatus('에셋을 불러오는 중입니다...');
    loadAssets()
      .then(() => {
        state.assetsReady = true;
        updateUiState();
        resizeCanvas();
        setStatus('에셋 로딩 완료. 설정을 시작하세요.');
      })
      .catch((error) => {
        state.assetsReady = false;
        state.assetErrors.push(error?.message || String(error));
        updateUiState();
        setStatus('에셋 로딩 실패: 로컬 서버로 열어주세요.');
      });
    requestAnimationFrame(render);
  }

  function cacheUi() {
    ui.canvas = document.getElementById('boardCanvas');
    ui.ctx = ui.canvas.getContext('2d');
    ui.boardSelect = document.getElementById('boardSelect');
    ui.modeSelect = document.getElementById('modeSelect');
    ui.playerCountSelect = document.getElementById('playerCountSelect');
    ui.startPlayerSelect = document.getElementById('startPlayerSelect');
    ui.startSetupBtn = document.getElementById('startSetupBtn');
    ui.startGameBtn = document.getElementById('startGameBtn');
    ui.resetBtn = document.getElementById('resetBtn');
    ui.setupHint = document.getElementById('setupHint');
    ui.obstacleList = document.getElementById('obstacleList');
    ui.clearObstaclesBtn = document.getElementById('clearObstaclesBtn');
    ui.turnInfo = document.getElementById('turnInfo');
    ui.placeNeutralBtn = document.getElementById('placeNeutralBtn');
    ui.connectGroupBtn = document.getElementById('connectGroupBtn');
    ui.passBtn = document.getElementById('passBtn');
    ui.endTurnBtn = document.getElementById('endTurnBtn');
    ui.inventoryList = document.getElementById('inventoryList');
    ui.logList = document.getElementById('logList');
    ui.statusBar = document.getElementById('statusBar');
  }

  function bindUi() {
    ui.boardSelect.addEventListener('change', () => {
      state.boardType = ui.boardSelect.value;
    });

    ui.modeSelect.addEventListener('change', () => {
      state.mode = ui.modeSelect.value;
    });

    ui.playerCountSelect.addEventListener('change', () => {
      state.playerCount = parseInt(ui.playerCountSelect.value, 10);
      updateStartPlayerOptions();
    });

    ui.startPlayerSelect.addEventListener('change', () => {
      state.startPlayerIndex = parseInt(ui.startPlayerSelect.value, 10);
    });

    ui.startSetupBtn.addEventListener('click', startSetup);
    ui.startGameBtn.addEventListener('click', startGame);
    ui.resetBtn.addEventListener('click', resetAll);
    ui.placeNeutralBtn.addEventListener('click', () => selectNeutralPlacement());
    ui.connectGroupBtn.addEventListener('click', connectGroupsAction);
    ui.passBtn.addEventListener('click', passTurn);
    ui.endTurnBtn.addEventListener('click', endTurn);
    ui.clearObstaclesBtn.addEventListener('click', clearObstacles);

    const rotAngleSlider = document.getElementById('rotAngleSlider');
    const rotAngleVal = document.getElementById('rotAngleVal');
    if (rotAngleSlider && rotAngleVal) {
      rotAngleSlider.addEventListener('input', (e) => {
        CONFIG.wheelRotationDeg = parseInt(e.target.value, 10);
        rotAngleVal.textContent = `${CONFIG.wheelRotationDeg}°`;
      });
    }

    ui.inventoryList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-tile]');
      if (!button) {
        return;
      }
      selectTilePlacement(button.dataset.tile);
    });

    ui.obstacleList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-obstacle]');
      if (!button) {
        return;
      }
      selectObstacleType(button.dataset.obstacle);
    });

    ui.canvas.addEventListener('pointerdown', onPointerDown);
    ui.canvas.addEventListener('pointermove', onPointerMove);
    ui.canvas.addEventListener('pointerup', onPointerUp);
    ui.canvas.addEventListener('pointercancel', onPointerUp);
    ui.canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
  }

  function updateStartPlayerOptions() {
    const count = parseInt(ui.playerCountSelect.value, 10);
    ui.startPlayerSelect.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `플레이어 ${i + 1}`;
      ui.startPlayerSelect.appendChild(option);
    }
    const nextIndex = Math.min(state.startPlayerIndex, count - 1);
    ui.startPlayerSelect.value = String(nextIndex);
    state.startPlayerIndex = nextIndex;
  }

  function updateBoardLabels() {
    if (!ui.boardSelect) {
      return;
    }
    Array.from(ui.boardSelect.options).forEach((option) => {
      const def = CONFIG.boardDefs[option.value];
      if (def && def.displayName) {
        option.textContent = def.displayName;
      }
    });
  }

  function resetAll() {
    state.phase = 'idle';
    state.board = null;
    state.players = [];
    state.turnOrder = [];
    state.turnPointer = 0;
    state.passStreak = 0;
    state.endSummary = '';
    state.actionUsed = false;
    state.placingTileTypeId = null;
    state.placingNeutral = false;
    state.selectedObstacleTypeId = null;
    state.selected = null;
    state.dragging = null;
    state.tiles = [];
    state.obstacles = [];
    state.connections = new Map();
    state.tileToGroup = new Map();
    state.bridgeRankings = [];
    state.classicRankings = [];
    state.setupStep = 'idle';
    state.regionSelectIndex = 0;
    state.regionOrder = [];
    state.obstaclePool = {};
    updateUiState();
    setStatus('설정 옵션을 선택한 뒤 설정 시작을 누르세요.');
    appendLog('초기화했습니다.');
  }

  function startSetup() {
    if (!state.assetsReady) {
      setStatus('에셋 로딩이 끝난 뒤 진행하세요.');
      return;
    }
    resetAll();
    state.boardType = ui.boardSelect.value;
    state.mode = ui.modeSelect.value;
    state.playerCount = parseInt(ui.playerCountSelect.value, 10);
    state.startPlayerIndex = parseInt(ui.startPlayerSelect.value, 10);
    state.board = buildBoard(state.boardType);
    if (!state.board) {
      setStatus('보드 에셋을 불러오지 못했습니다.');
      return;
    }
    updateViewScale();
    state.players = buildPlayers(state.playerCount);
    state.turnOrder = buildTurnOrder(state.playerCount, state.startPlayerIndex);
    state.regionOrder = [...state.turnOrder].reverse();
    state.phase = 'setup';
    state.setupStep = 'regions';
    state.regionSelectIndex = 0;
    state.obstaclePool = initObstaclePool();
    updateUiState();
    setStatus('영역 지정: 보드의 부채꼴 영역을 클릭하세요.');
    appendLog('설정을 시작했습니다.');
  }

  function startGame() {
    if (state.phase !== 'setup' || state.setupStep !== 'obstacles') {
      return;
    }
    if (!allPlayersHaveRegions()) {
      setStatus('먼저 영역을 지정하세요.');
      return;
    }
    state.tiles = [];
    state.connections = new Map();
    state.tileToGroup = new Map();
    distributeTiles();
    placeInitialNeutralTile();
    state.phase = 'play';
    state.turnPointer = 0;
    state.actionUsed = false;
    state.passStreak = 0;
    updateConnections();
    updateUiState();
    setStatus('게임이 시작되었습니다. 타일을 놓거나 이동하세요.');
    appendLog('게임이 시작되었습니다.');
  }

  function distributeTiles() {
    state.players.forEach((player) => {
      player.inventory = {};
      player.neutralLeft = CONFIG.neutralTileLimitPerPlayer;
    });

    Object.keys(CONFIG.tileCounts).forEach((tileId) => {
      const total = CONFIG.tileCounts[tileId];
      const def = CONFIG.tileDefs[tileId];
      if (!def || !def.basePoly) {
        return;
      }
      const perPlayer = Math.floor(total / state.playerCount);
      state.players.forEach((player) => {
        player.inventory[tileId] = perPlayer;
      });
    });
  }

  function placeInitialNeutralTile() {
    const typeId = neutralTileTypeIdForPlayers(state.playerCount);
    const tile = createTileInstance(typeId, null, true);
    if (!tile) {
      appendLog('중립 타일 에셋을 불러오지 못했습니다.');
      return;
    }
    tile.pos = { x: 0, y: 0 };
    if (!isTilePlacementValid(tile, [])) {
      const placed = trySpiralPlacement(tile, []);
      if (!placed) {
        appendLog('중립 타일을 놓을 수 없습니다. 장애물을 옮기고 다시 시도하세요.');
        return;
      }
    }
    state.tiles.push(tile);
  }

  function selectTilePlacement(tileId) {
    if (state.phase !== 'play') {
      return;
    }
    if (state.actionUsed) {
      setStatus('이번 턴의 행동은 이미 사용했습니다.');
      return;
    }
    const def = CONFIG.tileDefs[tileId];
    if (!def || !def.basePoly) {
      setStatus('해당 타일 에셋이 없습니다.');
      return;
    }
    const player = getCurrentPlayer();
    if (!player || player.inventory[tileId] <= 0) {
      return;
    }
    state.placingTileTypeId = tileId;
    state.placingNeutral = false;
    setStatus(`${tileLabel(tileId)} 배치 중입니다. 보드를 클릭해 놓으세요.`);
  }

  function selectNeutralPlacement() {
    if (state.phase !== 'play') {
      return;
    }
    if (state.actionUsed) {
      setStatus('이번 턴의 행동은 이미 사용했습니다.');
      return;
    }
    const player = getCurrentPlayer();
    if (!player || player.neutralLeft <= 0) {
      setStatus('남은 중립 타일이 없습니다.');
      return;
    }
    state.placingNeutral = true;
    state.placingTileTypeId = null;
    setStatus('중립 타일 배치 중입니다. 보드를 클릭해 놓으세요.');
  }

  function canConnectGroups() {
    const clusters = clusterVertices(state.tiles, CONFIG.snap.vertexDistCm);
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const angleSum = cluster.reduce((sum, entry) => sum + entry.angle, 0);
      const angleDeg = radToDeg(angleSum);
      if (Math.abs(angleDeg - 360) <= CONFIG.snap.vertexSumDeg) {
        const gids = new Set(cluster.map(c => findTileById(c.tileId).groupId));
        if (gids.size > 1) return true;
      }
    }
    return false;
  }

  function connectGroupsAction() {
    if (state.phase !== 'play' || state.actionUsed) return;
    const clusters = clusterVertices(state.tiles, CONFIG.snap.vertexDistCm);
    let merged = false;
    const groupIdsToMerge = new Set();
    
    clusters.forEach(cluster => {
      const angleSum = cluster.reduce((sum, entry) => sum + entry.angle, 0);
      const angleDeg = radToDeg(angleSum);
      if (Math.abs(angleDeg - 360) <= CONFIG.snap.vertexSumDeg) {
        const gids = new Set(cluster.map(c => findTileById(c.tileId).groupId));
        if (gids.size > 1) {
          gids.forEach(g => groupIdsToMerge.add(g));
          merged = true;
        }
      }
    });

    if (merged) {
      const targetGroupId = Array.from(groupIdsToMerge)[0];
      state.tiles.forEach(t => {
        if (groupIdsToMerge.has(t.groupId)) {
          t.groupId = targetGroupId;
        }
      });
      state.actionUsed = true;
      state.passStreak = 0;
      appendLog(`${getCurrentPlayer().name}이(가) 타일 그룹을 연결했습니다.`);
      updateConnections();
      checkBridgeWins();
      updateUiState();
    }
  }

  function passTurn() {
    if (state.phase !== 'play') {
      return;
    }
    if (state.actionUsed) {
      return;
    }
    const player = getCurrentPlayer();
    state.actionUsed = true;
    state.passStreak += 1;
    appendLog(`${player.name} 패스했습니다.`);
    updateUiState();
    if (state.mode === 'classic' && state.passStreak >= activePlayerCount()) {
      finishClassic();
      return;
    }
    if (state.mode === 'bridge' && state.passStreak >= activePlayerCount()) {
      finishBridge();
    }
  }

  function endTurn() {
    if (state.phase !== 'play') {
      return;
    }
    if (!state.actionUsed) {
      setStatus('턴을 종료하기 전에 행동하거나 패스하세요.');
      return;
    }
    state.actionUsed = false;
    state.placingTileTypeId = null;
    state.placingNeutral = false;
    advanceTurn();
    updateUiState();
  }

  function advanceTurn() {
    const active = activePlayerCount();
    if (active === 0) {
      return;
    }
    for (let i = 0; i < state.turnOrder.length; i += 1) {
      state.turnPointer = (state.turnPointer + 1) % state.turnOrder.length;
      const player = getCurrentPlayer();
      if (player && !player.finished) {
        setStatus(`${player.name}의 턴입니다.`);
        return;
      }
    }
  }

  function finishClassic() {
    if (state.classicRankings && state.classicRankings.length > 0) {
      const winnerNames = state.classicRankings.map((p) => p.name).join(', ');
      state.endSummary = `클래식 모드 종료: ${winnerNames} 승리 (모든 타일 소모)`;
    } else {
      const scores = state.players.map((player) => ({
        player,
        remaining: countRemainingTiles(player)
      }));
      const minRemaining = Math.min(...scores.map((score) => score.remaining));
      const winners = scores.filter((score) => score.remaining === minRemaining).map((score) => score.player);
      const winnerNames = winners.map((winner) => winner.name).join(', ');
      state.endSummary = winners.length === 1
        ? `${winnerNames} 승리 (남은 타일 ${minRemaining}개)`
        : `무승부 (${winnerNames}, 남은 타일 ${minRemaining}개)`;
    }

    state.phase = 'ended';
    updateUiState();
    setStatus(state.endSummary);
    appendLog(state.endSummary);
  }

  function finishBridge() {
    state.phase = 'ended';
    let summary = '브릿지 모드 종료: ';
    if (state.bridgeRankings && state.bridgeRankings.length > 0) {
      summary += state.bridgeRankings.map((p, i) => `${i + 1}등: ${p.name}`).join(', ');
    } else {
      summary += '아무도 완성하지 못했습니다 (무승부).';
    }
    state.endSummary = summary;
    updateUiState();
    setStatus('브릿지 모드 게임이 종료되었습니다.');
    appendLog(summary);
  }

  function updateUiState() {
    const inSetup = state.phase === 'setup';
    const inPlay = state.phase === 'play';
    const assetsReady = state.assetsReady;

    ui.startSetupBtn.disabled = !assetsReady || inSetup || inPlay;
    ui.startGameBtn.disabled = !assetsReady || !(inSetup && state.setupStep === 'obstacles');
    ui.clearObstaclesBtn.disabled = !assetsReady || !(inSetup && state.setupStep === 'obstacles');
    ui.placeNeutralBtn.disabled = !inPlay || state.actionUsed || !canPlaceNeutral();
    ui.connectGroupBtn.disabled = !inPlay || state.actionUsed || !canConnectGroups();
    ui.passBtn.disabled = !inPlay || state.actionUsed;
    ui.endTurnBtn.disabled = !inPlay;
    renderSetupHint();
    renderTurnInfo();
    renderInventory();
    renderObstacleList();
  }

  function renderSetupHint() {
    if (state.phase === 'idle') {
      ui.setupHint.textContent = '설정 옵션을 선택한 뒤 설정 시작을 누르세요.';
      return;
    }
    if (state.setupStep === 'regions') {
      const playerId = state.regionOrder[state.regionSelectIndex];
      const player = state.players[playerId];
      ui.setupHint.textContent = `${player.name} 영역을 지정하세요 (역순).`;
      return;
    }
    if (state.setupStep === 'obstacles') {
      ui.setupHint.textContent = '장애물을 배치한 뒤 게임 시작을 누르세요.';
      return;
    }
    ui.setupHint.textContent = '';
  }

  function renderTurnInfo() {
    if (state.phase === 'ended') {
      ui.turnInfo.textContent = state.endSummary || '종료됨.';
      return;
    }
    if (state.phase !== 'play') {
      ui.turnInfo.textContent = '시작되지 않음.';
      return;
    }
    const player = getCurrentPlayer();
    const actionText = state.actionUsed ? '사용됨' : '가능';
    ui.turnInfo.textContent = `${player.name} (${actionText})`;
  }

  function renderInventory() {
    ui.inventoryList.innerHTML = '';
    if (state.phase !== 'play') {
      return;
    }
    const player = getCurrentPlayer();
    state.availableTiles.forEach((tileId) => {
      const def = CONFIG.tileDefs[tileId];
      const count = player.inventory[tileId] || 0;
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('div');
      label.textContent = tileLabel(tileId);
      const countEl = document.createElement('div');
      countEl.className = 'count';
      countEl.textContent = `x${count}`;
      const btn = document.createElement('button');
      btn.textContent = '놓기';
      btn.dataset.tile = tileId;
      btn.disabled = count <= 0 || state.actionUsed;
      row.appendChild(label);
      row.appendChild(countEl);
      row.appendChild(btn);
      ui.inventoryList.appendChild(row);
    });
  }

  function renderObstacleList() {
    ui.obstacleList.innerHTML = '';
    if (state.phase !== 'setup' || state.setupStep !== 'obstacles') {
      return;
    }
    state.availableObstacles.forEach((obstacleId) => {
      const def = CONFIG.obstacleDefs[obstacleId];
      const count = state.obstaclePool[obstacleId] || 0;
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('div');
      label.textContent = obstacleLabel(obstacleId);
      const countEl = document.createElement('div');
      countEl.className = 'count';
      countEl.textContent = `x${count}`;
      const btn = document.createElement('button');
      btn.textContent = '선택';
      btn.dataset.obstacle = obstacleId;
      btn.disabled = count <= 0;
      if (state.selectedObstacleTypeId === obstacleId) {
        btn.classList.add('secondary');
      }
      row.appendChild(label);
      row.appendChild(countEl);
      row.appendChild(btn);
      ui.obstacleList.appendChild(row);
    });
  }

  function appendLog(text) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = text;
    ui.logList.prepend(entry);
    while (ui.logList.children.length > 50) {
      ui.logList.removeChild(ui.logList.lastChild);
    }
  }

  function setStatus(text) {
    ui.statusBar.textContent = text;
  }

  function selectObstacleType(obstacleId) {
    if (state.phase !== 'setup' || state.setupStep !== 'obstacles') {
      return;
    }
    const def = CONFIG.obstacleDefs[obstacleId];
    if (!def || !def.basePoly) {
      setStatus('해당 장애물 에셋이 없습니다.');
      return;
    }
    if ((state.obstaclePool[obstacleId] || 0) <= 0) {
      return;
    }
    state.selectedObstacleTypeId = obstacleId;
    setStatus(`${obstacleLabel(obstacleId)} 선택됨. 보드를 클릭해 배치하세요.`);
    updateUiState();
  }

  function clearObstacles() {
    if (state.phase !== 'setup') {
      return;
    }
    state.obstacles = [];
    state.obstaclePool = initObstaclePool();
    state.selectedObstacleTypeId = null;
    updateUiState();
    appendLog('장애물을 모두 지웠습니다.');
  }

  function canPlaceNeutral() {
    if (state.phase !== 'play') {
      return false;
    }
    const player = getCurrentPlayer();
    if (!player) {
      return false;
    }
    return player.neutralLeft > 0;
  }

  function buildBoard(type) {
    const def = CONFIG.boardDefs[type];
    const asset = state.assets.boards[type];
    if (!def || !asset) {
      return null;
    }
    const polygon = asset.polygon;
    const cornerPoly = asset.cornerPoly || asset.polygon;
    const sides = cornerPoly.length;
    const sideCm = polygonPerimeter(cornerPoly) / sides;
    const regions = buildRegions(cornerPoly, CONFIG.regionRadiusCm, CONFIG.region.arcSegments);
    return { type, sides, sideCm, polygon, regions };
  }

  function buildPlayers(count) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
      players.push({
        id: i,
        name: `플레이어 ${i + 1}`,
        color: CONFIG.playerColors[i] || '#cccccc',
        inventory: {},
        regions: [],
        finished: false,
        neutralLeft: CONFIG.neutralTileLimitPerPlayer
      });
    }
    return players;
  }

  function buildTurnOrder(count, startIndex) {
    const order = [];
    for (let i = 0; i < count; i += 1) {
      order.push((startIndex + i) % count);
    }
    return order;
  }

  function initObstaclePool() {
    const pool = {};
    Object.keys(CONFIG.obstacleCounts).forEach((id) => {
      const def = CONFIG.obstacleDefs[id];
      if (!def || !def.basePoly) {
        return;
      }
      pool[id] = CONFIG.obstacleCounts[id];
    });
    return pool;
  }

  function allPlayersHaveRegions() {
    return state.players.every((player) => player.regions.length > 0);
  }

  function neutralTileTypeIdForPlayers(playerCount) {
    if (playerCount === 2) {
      return '정사각형_타일';
    }
    if (playerCount === 3) {
      return '정육각형_타일';
    }
    return '정팔각형_타일';
  }

  async function loadAssets() {
    state.assetErrors = [];
    state.assets = { boards: {}, tiles: {}, obstacles: {} };
    const tasks = [];

    try {
      const resp = await fetch('asset/assets.json');
      const manifest = await resp.json();
      
      CONFIG.boardDefs = {};
      manifest.boards.forEach(b => {
        CONFIG.boardDefs[b.name] = { name: b.name, file: b.file };
      });
      
      CONFIG.tileDefs = {};
      CONFIG.tileCounts = {};
      const exactTileCounts = {
        '정삼각형_타일': 20,
        '정사각형_타일': 16,
        '정오각형_타일': 8,
        '정육각형_타일': 12,
        '정팔각형_타일': 8
      };
      manifest.tiles.forEach(t => {
        CONFIG.tileDefs[t.name] = { name: t.name, file: t.file };
        CONFIG.tileCounts[t.name] = exactTileCounts[t.name] || 4;
      });
      
      CONFIG.obstacleDefs = {};
      CONFIG.obstacleCounts = {};
      manifest.obstacles.forEach(o => {
        CONFIG.obstacleDefs[o.name] = { name: o.name, file: o.file };
        CONFIG.obstacleCounts[o.name] = 8;
      });
    } catch (e) {
      state.assetErrors.push('assets.json 파일을 불러오지 못했습니다. update_assets.js 스크립트를 실행했는지 확인하세요.');
      return;
    }

    const boardSelect = document.getElementById('boardSelect');
    if (boardSelect) {
      boardSelect.innerHTML = '';
      Object.keys(CONFIG.boardDefs).forEach((key, index) => {
        const def = CONFIG.boardDefs[key];
        const option = document.createElement('option');
        option.value = key;
        option.textContent = def.displayName || def.name;
        boardSelect.appendChild(option);
        if (index === 0 && (!state.boardType || !CONFIG.boardDefs[state.boardType])) {
          state.boardType = key;
        }
      });
    }

    Object.entries(CONFIG.boardDefs).forEach(([key, def]) => {
      if (!def.file) {
        state.assetErrors.push(`보드 파일이 없습니다: ${def.name}`);
        return;
      }
      def.displayName = fileDisplayName(def.file);
      tasks.push(
        loadDxfShape(def.file)
          .then((shape) => {
            state.assets.boards[key] = shape;
          })
          .catch(() => {
            state.assetErrors.push(`보드 에셋 로딩 실패: ${def.name}`);
          })
      );
    });

    Object.entries(CONFIG.tileDefs).forEach(([id, def]) => {
      if (!def.file) {
        state.assetErrors.push(`타일 파일이 없습니다: ${id} ${def.name}`);
        return;
      }
      def.displayName = fileDisplayName(def.file);
      tasks.push(
        loadDxfShape(def.file)
          .then((shape) => {
            def.basePoly = shape.cornerPoly || shape.polygon;
            def.vertexAngles = computeInternalAngles(def.basePoly);
          })
          .catch(() => {
            state.assetErrors.push(`타일 에셋 로딩 실패: ${id} ${def.name}`);
          })
      );
    });

    Object.entries(CONFIG.obstacleDefs).forEach(([id, def]) => {
      if (!def.file) {
        state.assetErrors.push(`장애물 파일이 없습니다: ${id} ${def.name}`);
        return;
      }
      def.displayName = fileDisplayName(def.file);
      tasks.push(
        loadDxfShape(def.file)
          .then((shape) => {
            def.basePoly = shape.polygon;
          })
          .catch(() => {
            state.assetErrors.push(`장애물 에셋 로딩 실패: ${id} ${def.name}`);
          })
      );
    });

    await Promise.all(tasks);

    state.availableTiles = Object.keys(CONFIG.tileDefs).filter((id) => {
      const def = CONFIG.tileDefs[id];
      return def && def.basePoly;
    });
    state.availableObstacles = Object.keys(CONFIG.obstacleDefs).filter((id) => {
      const def = CONFIG.obstacleDefs[id];
      return def && def.basePoly;
    });

    updateBoardLabels();
    updateMaxAssistFromAssets();

    if (state.assetErrors.length > 0) {
      state.assetErrors.forEach((message) => appendLog(message));
    }

    if (Object.keys(state.assets.boards).length === 0) {
      throw new Error('보드 에셋을 불러오지 못했습니다.');
    }
  }

  async function loadDxfShape(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`에셋 불러오기 실패: ${path}`);
    }
    const text = await response.text();
    const dxf = parseDxf(text);
    const polyline = selectPrimaryPolyline(dxf.polylines);
    if (!polyline) {
      throw new Error(`DXF 폴리라인이 없습니다: ${path}`);
    }
    const expanded = polylineToPoints(polyline.vertices, polyline.closed, CONFIG.arcSampleDeg);
    const raw = polyline.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const scale = unitScaleToCm(dxf.units);
    const expandedScaled = expanded.map((point) => scalePoint(point, scale));
    const rawScaled = raw.map((point) => scalePoint(point, scale));
    const centroid = polygonCentroid(expandedScaled);
    const polygon = ensureCounterClockwise(centerPolygonWithCentroid(expandedScaled, centroid));
    const cornerPoly = ensureCounterClockwise(centerPolygonWithCentroid(rawScaled, centroid));
    return { polygon, cornerPoly };
  }

  function parseDxf(text) {
    const lines = text.split(/\r?\n/);
    const polylines = [];
    let units = null;
    let i = 0;
    while (i < lines.length - 1) {
      const code = lines[i].trim();
      const value = lines[i + 1] != null ? lines[i + 1].trim() : '';
      i += 2;
      if (code === '9' && value === '$INSUNITS') {
        const nextCode = lines[i] ? lines[i].trim() : '';
        const nextValue = lines[i + 1] ? lines[i + 1].trim() : '';
        if (nextCode === '70') {
          units = parseInt(nextValue, 10);
          i += 2;
        }
      }
      if (code === '0' && (value === 'LWPOLYLINE' || value === 'SPLINE')) {
        const entity = { vertices: [], closed: value === 'SPLINE' ? true : false };
        let current = null;
        while (i < lines.length - 1) {
          const entityCode = lines[i].trim();
          const entityValue = lines[i + 1] != null ? lines[i + 1].trim() : '';
          if (entityCode === '0') {
            break;
          }
          if (entityCode === '70') {
            entity.closed = (parseInt(entityValue, 10) & 1) === 1;
          }
          if (entityCode === '10') {
            current = { x: parseFloat(entityValue), y: 0, bulge: 0 };
            entity.vertices.push(current);
          }
          if (entityCode === '20') {
            if (!current) {
              current = { x: 0, y: 0, bulge: 0 };
              entity.vertices.push(current);
            }
            current.y = parseFloat(entityValue);
          }
          if (entityCode === '42' && value === 'LWPOLYLINE') {
            if (!current) {
              current = { x: 0, y: 0, bulge: 0 };
              entity.vertices.push(current);
            }
            current.bulge = parseFloat(entityValue);
          }
          i += 2;
        }
        polylines.push(entity);
      }
    }
    return { units, polylines };
  }

  function selectPrimaryPolyline(polylines) {
    let best = null;
    let bestArea = -Infinity;
    polylines.forEach((polyline) => {
      const points = polylineToPoints(polyline.vertices, polyline.closed, CONFIG.arcSampleDeg);
      const area = Math.abs(polygonArea(points));
      if (area > bestArea) {
        bestArea = area;
        best = polyline;
      }
    });
    return best;
  }

  function polylineToPoints(vertices, closed, arcSampleDeg) {
    if (!vertices || vertices.length === 0) {
      return [];
    }
    const rawPoints = [];
    const count = vertices.length;
    const segmentCount = closed ? count : count - 1;
    for (let i = 0; i < segmentCount; i += 1) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % count];
      if (i === 0) {
        rawPoints.push({ x: v1.x, y: v1.y });
      }
      if (v1.bulge && Math.abs(v1.bulge) > 1e-6) {
        const arcPoints = bulgeArcPoints(v1, v2, v1.bulge, arcSampleDeg);
        rawPoints.push(...arcPoints.slice(1));
      } else {
        rawPoints.push({ x: v2.x, y: v2.y });
      }
    }
    
    const points = [];
    for (let i = 0; i < rawPoints.length; i += 1) {
      const pt = rawPoints[i];
      if (points.length > 0) {
        const prev = points[points.length - 1];
        if (Math.hypot(pt.x - prev.x, pt.y - prev.y) < 1e-6) {
          continue;
        }
      }
      points.push(pt);
    }
    
    if (closed && points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
        points.pop();
      }
    }
    
    return points;
  }

  function bulgeArcPoints(v1, v2, bulge, arcSampleDeg) {
    const chord = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    const angle = 4 * Math.atan(bulge);
    if (Math.abs(angle) < 1e-6 || chord < 1e-6) {
      return [{ x: v1.x, y: v1.y }, { x: v2.x, y: v2.y }];
    }
    const radius = chord / (2 * Math.sin(Math.abs(angle) / 2));
    const sagitta = Math.abs(bulge) * chord / 2;
    const offset = radius - sagitta;
    const chordDir = normalize(sub(v2, v1));
    const perp = { x: -chordDir.y, y: chordDir.x };
    const sign = bulge >= 0 ? 1 : -1;
    const mid = scale(add(v1, v2), 0.5);
    const center = add(mid, scale(perp, offset * sign));
    const startAngle = Math.atan2(v1.y - center.y, v1.x - center.x);
    const endAngle = Math.atan2(v2.y - center.y, v2.x - center.x);
    let sweep = endAngle - startAngle;
    if (bulge > 0 && sweep < 0) {
      sweep += 2 * Math.PI;
    }
    if (bulge < 0 && sweep > 0) {
      sweep -= 2 * Math.PI;
    }
    const step = degToRad(Math.max(2, arcSampleDeg));
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / step));
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angleAt = startAngle + sweep * t;
      points.push({
        x: center.x + radius * Math.cos(angleAt),
        y: center.y + radius * Math.sin(angleAt)
      });
    }
    return points;
  }

  function unitScaleToCm(insUnits) {
    switch (insUnits) {
      case 4:
        return 0.1;
      case 5:
        return 1;
      case 6:
        return 100;
      case 1:
        return 2.54;
      case 2:
        return 30.48;
      default:
        return 1;
    }
  }

  function scalePoint(point, scale) {
    return { x: point.x * scale, y: point.y * scale };
  }

  function centerPolygonWithCentroid(points, centroid) {
    return points.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
  }

  function ensureCounterClockwise(points) {
    if (polygonArea(points) < 0) {
      return [...points].reverse();
    }
    return points;
  }

  function polygonCentroid(points) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p0 = points[i];
      const p1 = points[(i + 1) % points.length];
      const cross = p0.x * p1.y - p1.x * p0.y;
      area += cross;
      cx += (p0.x + p1.x) * cross;
      cy += (p0.y + p1.y) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-6) {
      return { x: 0, y: 0 };
    }
    cx /= 6 * area;
    cy /= 6 * area;
    return { x: cx, y: cy };
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p0 = points[i];
      const p1 = points[(i + 1) % points.length];
      area += p0.x * p1.y - p1.x * p0.y;
    }
    return area / 2;
  }

  function polygonPerimeter(points) {
    let length = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p0 = points[i];
      const p1 = points[(i + 1) % points.length];
      length += Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }
    return length;
  }

  function polygonBounds(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return { minX, minY, maxX, maxY };
  }

  function buildRegions(boardPolygon, radiusCm, segments) {
    const regions = [];
    for (let i = 0; i < boardPolygon.length; i += 1) {
      const prev = boardPolygon[(i - 1 + boardPolygon.length) % boardPolygon.length];
      const curr = boardPolygon[i];
      const next = boardPolygon[(i + 1) % boardPolygon.length];
      const v1 = normalize(sub(prev, curr));
      const v2 = normalize(sub(next, curr));
      const angle1 = Math.atan2(v1.y, v1.x);
      const signedDelta = Math.atan2(cross(v1, v2), dot(v1, v2));
      const arc = arcPoints(curr, radiusCm, angle1, angle1 + signedDelta, segments);
      regions.push({
        index: i,
        ownerId: null,
        polygon: [curr, ...arc]
      });
    }
    return regions;
  }

  function arcPoints(center, radius, startAngle, endAngle, segments) {
    const points = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const angle = startAngle + (endAngle - startAngle) * t;
      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      });
    }
    return points;
  }

  function createTileInstance(typeId, ownerId, isNeutral) {
    const def = CONFIG.tileDefs[typeId];
    if (!def || !def.basePoly) {
      return null;
    }
    return {
      id: makeId('tile'),
      groupId: makeId('group'),
      typeId,
      ownerId,
      isNeutral: Boolean(isNeutral),
      pos: { x: 0, y: 0 },
      rot: 0,
      basePoly: def.basePoly,
      vertexAngles: def.vertexAngles
    };
  }

  function createObstacleInstance(typeId) {
    const def = CONFIG.obstacleDefs[typeId];
    if (!def || !def.basePoly) {
      return null;
    }
    return {
      id: makeId('obs'),
      typeId,
      pos: { x: 0, y: 0 },
      rot: 0,
      basePoly: def.basePoly
    };
  }

  function makeId(prefix) {
    const value = `${prefix}-${idCounter}`;
    idCounter += 1;
    return value;
  }

  function resizeCanvas() {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ui.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    ui.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    state.view.dpr = dpr;
    state.view.offset = { x: ui.canvas.width / 2, y: ui.canvas.height / 2 };
    updateViewScale();
  }

  function updateViewScale() {
    const dpr = state.view.dpr || 1;
    let scale = CONFIG.pxPerCm * dpr;
    if (state.board) {
      const bounds = polygonBounds(state.board.polygon);
      const width = Math.max(1e-6, bounds.maxX - bounds.minX);
      const height = Math.max(1e-6, bounds.maxY - bounds.minY);
      const padding = 0.12;
      const scaleX = ui.canvas.width / (width * (1 + padding));
      const scaleY = ui.canvas.height / (height * (1 + padding));
      scale = Math.min(scaleX, scaleY);
    }
    state.view.scale = scale;
  }

  function onPointerDown(event) {
    const point = screenToWorld(event);

    if (state.selected && state.selected.type === 'tileGroup' && state.rotationHandlePos) {
      const dx = event.clientX - state.rotationHandlePos.x;
      const dy = event.clientY - state.rotationHandlePos.y;
      if (Math.hypot(dx, dy) < 16) { // 16px hit radius
        const pivot = groupCentroid(state.selected.ids);
        const startPositions = new Map();
        const startRotations = new Map();
        state.selected.ids.forEach(id => {
          const t = findTileById(id);
          startPositions.set(id, { ...t.pos });
          startRotations.set(id, t.rot);
        });
        state.dragging = {
          type: 'rotateGroup',
          ids: state.selected.ids,
          pointerId: event.pointerId,
          pivot: pivot,
          startPointer: { x: event.clientX, y: event.clientY },
          startPositions: startPositions,
          startRotations: startRotations,
          startAngle: Math.atan2(point.y - pivot.y, point.x - pivot.x),
          isValid: true
        };
        ui.canvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (state.phase === 'setup' && state.setupStep === 'regions') {
      if (tryAssignRegion(point)) {
        return;
      }
    }

    if (state.phase === 'setup' && state.setupStep === 'obstacles') {
      if (state.selectedObstacleTypeId) {
        const obstacle = createObstacleInstance(state.selectedObstacleTypeId);
        if (!obstacle) {
          setStatus('해당 장애물 에셋이 없습니다.');
          return;
        }
        obstacle.pos = point;
        state.obstacles.push(obstacle);
        state.obstaclePool[state.selectedObstacleTypeId] -= 1;
        state.dragging = {
          type: 'obstacle',
          id: obstacle.id,
          startPointer: point,
          startPos: { ...obstacle.pos },
          isNew: true,
          pointerId: event.pointerId
        };
        ui.canvas.setPointerCapture(event.pointerId);
        updateUiState();
        return;
      }

      const obstacleId = findObstacleAtPoint(point);
      if (obstacleId) {
        const obstacle = findObstacleById(obstacleId);
        state.selected = { type: 'obstacle', id: obstacleId };
        state.dragging = {
          type: 'obstacle',
          id: obstacleId,
          startPointer: point,
          startPos: { ...obstacle.pos },
          isNew: false,
          pointerId: event.pointerId
        };
        ui.canvas.setPointerCapture(event.pointerId);
        updateUiState();
      }
      return;
    }

    if (state.phase === 'play') {
      if (state.placingTileTypeId || state.placingNeutral) {
        const tile = createTileInstance(
          state.placingTileTypeId || neutralTileTypeIdForPlayers(state.playerCount),
          state.placingNeutral ? null : getCurrentPlayer().id,
          Boolean(state.placingNeutral)
        );
        if (!tile) {
          setStatus('해당 타일 에셋이 없습니다.');
          return;
        }
        tile.pos = point;
        state.dragging = {
          type: 'ghost',
          tile,
          startPointer: point,
          pointerId: event.pointerId,
          isValid: true
        };
        ui.canvas.setPointerCapture(event.pointerId);
        return;
      }

      const tileId = findTileAtPoint(point);
      if (tileId) {
        const group = getTileGroup(tileId);
        state.selected = { type: 'tileGroup', ids: group };
        state.dragging = {
          type: 'tileGroup',
          ids: group,
          lastPointer: point,
          pointerId: event.pointerId
        };
        ui.canvas.setPointerCapture(event.pointerId);
        updateUiState();
      } else {
        state.selected = null;
        updateUiState();
      }
    }
  }

  function onPointerMove(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
      return;
    }
    const point = screenToWorld(event);
    if (state.dragging.type === 'tileGroup') {
      const delta = sub(point, state.dragging.lastPointer);
      attemptMoveGroup(state.dragging.ids, delta);
      state.dragging.lastPointer = point;
      return;
    }
    if (state.dragging.type === 'rotateGroup') {
      const currentAngle = Math.atan2(point.y - state.dragging.pivot.y, point.x - state.dragging.pivot.x);
      const angleDelta = currentAngle - state.dragging.startAngle;
      
      const newPositions = new Map();
      state.dragging.ids.forEach((id) => {
        const startPos = state.dragging.startPositions.get(id);
        const p = rotateAround(startPos, state.dragging.pivot, angleDelta);
        newPositions.set(id, p);
      });
      
      state.dragging.ids.forEach((id) => {
        const tile = findTileById(id);
        tile.pos = newPositions.get(id);
        tile.rot = state.dragging.startRotations.get(id) + angleDelta;
      });
      
      state.dragging.isValid = isGroupPlacementValid(state.dragging.ids, newPositions, angleDelta);
      return;
    }
    if (state.dragging.type === 'obstacle') {
      const obstacle = findObstacleById(state.dragging.id);
      const delta = sub(point, state.dragging.startPointer);
      obstacle.pos = add(state.dragging.startPos, delta);
      return;
    }
    if (state.dragging.type === 'ghost') {
      state.dragging.tile.pos = point;
      state.dragging.isValid = validateGhostPlacement(state.dragging.tile);
    }
  }

  function onPointerUp(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
      return;
    }
    if (state.dragging.type === 'ghost') {
      commitGhostTile(state.dragging.tile, state.dragging.isValid);
    }
    if (state.dragging.type === 'tileGroup') {
      snapGroupToConnections(state.dragging.ids);
      updateConnections();
      alignVertexClustersToExact();
      weldSharedVertices();
      updateConnections();
      checkBridgeWins();
    }
    if (state.dragging.type === 'rotateGroup') {
      if (state.dragging.isValid === false) {
        state.dragging.ids.forEach((id) => {
          const tile = findTileById(id);
          tile.pos = state.dragging.startPositions.get(id);
          tile.rot = state.dragging.startRotations.get(id);
        });
        setStatus('유효하지 않은 위치입니다.');
      } else {
        snapGroupToConnections(state.dragging.ids);
        updateConnections();
        alignVertexClustersToExact();
        weldSharedVertices();
        updateConnections();
        checkBridgeWins();
      }
    }
    if (state.dragging.type === 'obstacle') {
      finalizeObstaclePlacement(state.dragging);
    }
    ui.canvas.releasePointerCapture(event.pointerId);
    state.dragging = null;
    updateUiState();
  }

  function onWheel(event) {
    if (!event.shiftKey) {
      return;
    }
    event.preventDefault();
    const dir = event.deltaY > 0 ? 1 : -1;
    const angleDeltaDeg = dir * CONFIG.wheelRotationDeg;
    const angle = degToRad(angleDeltaDeg);

    if (state.dragging && state.dragging.type === 'ghost') {
      state.dragging.tile.rot += angle;
      state.dragging.isValid = validateGhostPlacement(state.dragging.tile);
      updateUiState();
      return;
    }

    if (state.dragging && state.dragging.type === 'obstacle') {
      const obstacle = findObstacleById(state.dragging.id);
      obstacle.rot += angle;
      updateUiState();
      return;
    }

    if (!state.selected || state.selected.type !== 'tileGroup') {
      return;
    }
    const ids = state.selected.ids;
    
    if (rotateGroupElements(ids, angle)) {
      if (!(state.dragging && state.dragging.type === 'tileGroup')) {
        snapGroupToConnections(ids);
        updateConnections();
        alignVertexClustersToExact();
        weldSharedVertices();
        updateConnections();
        checkBridgeWins();
      }
      updateUiState();
    } else {
      setStatus('회전할 수 없습니다 (충돌 발생).');
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      state.placingTileTypeId = null;
      state.placingNeutral = false;
      state.selectedObstacleTypeId = null;
      state.dragging = null;
      updateUiState();
      setStatus('배치가 취소되었습니다.');
      return;
    }
    
    if (event.key === 'Delete' && state.phase === 'setup' && state.selected?.type === 'obstacle') {
      removeObstacle(state.selected.id);
    }
  }

  function tryAssignRegion(point) {
    const regionIndex = findRegionAtPoint(point);
    if (regionIndex == null) {
      return false;
    }
    const region = state.board.regions[regionIndex];
    if (region.ownerId != null) {
      return false;
    }
    const playerId = state.regionOrder[state.regionSelectIndex];
    const player = state.players[playerId];
    if (!player) {
      return false;
    }
    assignRegion(player, regionIndex);
    if (state.mode === 'bridge') {
      const opposite = (regionIndex + state.board.sides / 2) % state.board.sides;
      if (state.board.regions[opposite].ownerId != null) {
        setStatus('맞은편 영역이 이미 지정되었습니다.');
        return true;
      }
      assignRegion(player, opposite);
    }
    state.regionSelectIndex += 1;
    if (state.regionSelectIndex >= state.playerCount) {
      state.setupStep = 'obstacles';
      setStatus('장애물을 배치한 뒤 게임 시작을 누르세요.');
    }
    updateUiState();
    return true;
  }

  function assignRegion(player, regionIndex) {
    const region = state.board.regions[regionIndex];
    region.ownerId = player.id;
    player.regions.push(regionIndex);
    appendLog(`${player.name}이(가) 영역 ${regionIndex + 1}을(를) 선택했습니다.`);
  }

  function finalizeObstaclePlacement(dragging) {
    const obstacle = findObstacleById(dragging.id);
    if (!obstacle) {
      return;
    }
    const isValid = isObstaclePlacementValid(obstacle, dragging.id);
    if (!isValid) {
      if (dragging.isNew) {
        removeObstacle(obstacle.id);
        state.obstaclePool[obstacle.typeId] += 1;
      } else {
        obstacle.pos = { ...dragging.startPos };
      }
      setStatus('유효하지 않은 장애물 위치입니다.');
    }
    updateUiState();
  }

  function validateGhostPlacement(tile) {
    // Try snap first - the ghost should show as valid if snapping would produce a valid placement
    const simTile = { ...tile, pos: { ...tile.pos }, rot: tile.rot };
    const snap = findBestSnapTranslation(simTile, state.tiles, true);
    if (snap) {
      simTile.pos = add(simTile.pos, snap.translation);
      simTile.rot += snap.rotation || 0;
    }
    if (!isTilePlacementValid(simTile, [])) {
      return false;
    }
    if (tile.isNeutral) {
      return isTileInPlayerRegion(simTile, getCurrentPlayer());
    }
    const tempTiles = [...state.tiles, simTile];
    const connections = computeConnections(tempTiles);
    const neighbors = connections.get(simTile.id);
    return neighbors && neighbors.size > 0;
  }

  function commitGhostTile(tile, isValid) {
    if (!isValid) {
      setStatus('유효하지 않은 배치입니다.');
      return;
    }
    if (tile.isNeutral) {
      if (!placeNeutralTile(tile)) {
        setStatus('중립 타일은 내 영역과 닿아야 하며 충돌이 없어야 합니다.');
        return;
      }
    } else {
      if (!placePlayerTile(tile)) {
        setStatus('타일은 변 또는 꼭짓점으로 연결되어야 합니다.');
        return;
      }
    }
    updateConnections();
    alignVertexClustersToExact();
    weldSharedVertices();
    updateConnections();
    checkBridgeWins();
    updateUiState();
  }

  function placePlayerTile(tile) {
    const player = getCurrentPlayer();
    if (!player || state.actionUsed) {
      return false;
    }
    const def = CONFIG.tileDefs[tile.typeId];
    if (!def || player.inventory[tile.typeId] <= 0) {
      return false;
    }
    // Try snap FIRST, before validation
    const snapped = tryEdgeSnap(tile, state.tiles);
    if (!isTilePlacementValid(tile, [])) {
      return false;
    }
    const tempTiles = [...state.tiles, tile];
    const connections = computeConnections(tempTiles);
    const neighbors = connections.get(tile.id);
    if (!neighbors || neighbors.size === 0) {
      return false;
    }
    const neighborId = Array.from(neighbors)[0];
    const neighbor = tempTiles.find(t => t.id === neighborId);
    if (neighbor) {
      tile.groupId = neighbor.groupId;
    }
    player.inventory[tile.typeId] -= 1;

    if (state.mode === 'classic' && countRemainingTiles(player) === 0 && !player.classicFinished) {
      player.classicFinished = true;
      if (!state.classicRankings) state.classicRankings = [];
      state.classicRankings.push(player);
      appendLog(`${player.name}이(가) 타일을 모두 소모하여 승리했습니다!`);
      setStatus(`${player.name}이(가) 타일을 모두 소모하여 승리했습니다!`);
    }

    state.tiles.push(tile);
    snapGroupToConnections([tile.id]);
    state.actionUsed = true;
    state.passStreak = 0;
    appendLog(`${player.name}이(가) ${tileLabel(tile.typeId)}을(를) 배치했습니다.`);
    return true;
  }

  function placeNeutralTile(tile) {
    const player = getCurrentPlayer();
    if (!player || state.actionUsed) {
      return false;
    }
    // Try snap FIRST, before validation
    const snapped = tryEdgeSnap(tile, state.tiles);
    if (!isTilePlacementValid(tile, [])) {
      return false;
    }
    if (!isTileInPlayerRegion(tile, player)) {
      return false;
    }
    const tempTiles = [...state.tiles, tile];
    const connections = computeConnections(tempTiles);
    const neighbors = connections.get(tile.id);
    if (neighbors && neighbors.size > 0) {
      const neighborId = Array.from(neighbors)[0];
      const neighbor = tempTiles.find(t => t.id === neighborId);
      if (neighbor) {
        tile.groupId = neighbor.groupId;
      }
    }
    state.tiles.push(tile);
    snapGroupToConnections([tile.id]);
    if (Number.isFinite(player.neutralLeft)) {
      player.neutralLeft -= 1;
    }
    state.actionUsed = true;
    state.passStreak = 0;
    appendLog(`${player.name}이(가) 중립 타일을 배치했습니다.`);
    return true;
  }

  function tryEdgeSnap(tile, tiles) {
    const snap = findBestSnapTranslation(tile, tiles, true);
    if (!snap) {
      return false;
    }
    if (snap.rotation) {
      tile.rot += snap.rotation;
    }
    tile.pos = add(tile.pos, snap.translation);
    return true;
  }

  function findEdgeSnap(tile, other, allowRotation) {
    if (!edgeConnectionAllowed(tile, other)) {
      return null;
    }
    const polyA = transformPolygon(tile.basePoly, tile.pos, tile.rot);
    const polyB = transformPolygon(other.basePoly, other.pos, other.rot);
    const edgesA = polygonEdges(polyA);
    const edgesB = polygonEdges(polyB);
    const angleTol = Math.cos(degToRad(CONFIG.snap.edgeAngleDeg));
    let best = null;
    edgesA.forEach((edgeA) => {
      edgesB.forEach((edgeB) => {
        const dirA = normalize(sub(edgeA.b, edgeA.a));
        const dirB = normalize(sub(edgeB.b, edgeB.a));
        const dotVal = dirA.x * dirB.x + dirA.y * dirB.y;
        if (dotVal > -angleTol) {
          return;
        }

        // Step 1: Direction alignment — compute exact rotation to make dirA == -dirB
        const rotation = allowRotation ? angleBetween(dirA, scale(dirB, -1)) : 0;
        if (allowRotation && Math.abs(rotation) > degToRad(CONFIG.snap.edgeAngleDeg)) {
          return;
        }

        const rotatedA = {
          a: rotateAround(edgeA.a, tile.pos, rotation),
          b: rotateAround(edgeA.b, tile.pos, rotation)
        };

        // Step 2: Perpendicular projection — move edge A onto edge B's line
        const midA = scale(add(rotatedA.a, rotatedA.b), 0.5);
        const edgeBDir = normalize(sub(edgeB.b, edgeB.a));
        const edgeBNormal = { x: -edgeBDir.y, y: edgeBDir.x };
        const midToB = sub(edgeB.a, midA);
        const perpDist = dot(midToB, edgeBNormal);
        const perpTranslation = scale(edgeBNormal, perpDist);

        // Step 3: Endpoint slide — after perp projection, slide along edge B
        // so that the edges overlap optimally (endpoints align)
        const projA = {
          a: add(rotatedA.a, perpTranslation),
          b: add(rotatedA.b, perpTranslation)
        };

        // Project both edge endpoints onto edgeB direction to find best slide
        const lenA = edgeLength(projA);
        const lenB = edgeLength(edgeB);
        // edgeA goes in reverse direction of edgeB, so projA.a corresponds to edgeB.b side
        // Find slide candidates: align a-to-b endpoints or a-to-a endpoints
        const slideCandidates = [];

        // Candidate 0: pure perpendicular (no slide, preserves user's placement)
        slideCandidates.push({ x: 0, y: 0 });
        // Candidate 1: align projA.a with edgeB.b (matching endpoints)
        slideCandidates.push(sub(edgeB.b, projA.a));
        // Candidate 2: align projA.b with edgeB.a (matching endpoints)
        slideCandidates.push(sub(edgeB.a, projA.b));
        // Candidate 3: center edges on each other
        const midB = scale(add(edgeB.a, edgeB.b), 0.5);
        const projMidA = scale(add(projA.a, projA.b), 0.5);
        slideCandidates.push(sub(midB, projMidA));
        // Candidates 4-5: closestPointOnSegment for each endpoint (original approach fallback)
        const closestA = closestPointOnSegment(rotatedA.a, edgeB.a, edgeB.b);
        slideCandidates.push(sub(sub(closestA, rotatedA.a), perpTranslation));
        const closestB = closestPointOnSegment(rotatedA.b, edgeB.a, edgeB.b);
        slideCandidates.push(sub(sub(closestB, rotatedA.b), perpTranslation));

        slideCandidates.forEach((slideVec) => {
          // Only allow slide along edge direction, keep perpendicular component
          const slideAlongEdge = scale(edgeBDir, dot(slideVec, edgeBDir));
          const translation = add(perpTranslation, slideAlongEdge);
          const assist = Math.hypot(translation.x, translation.y);
          if (assist > CONFIG.snap.maxAssistCm) {
            return;
          }
          const movedA = {
            a: add(rotatedA.a, translation),
            b: add(rotatedA.b, translation)
          };
          const finalMidA = scale(add(movedA.a, movedA.b), 0.5);
          const distance = pointLineDistance(finalMidA, edgeB.a, edgeB.b);
          if (distance > CONFIG.snap.edgeDistCm) {
            return;
          }
          const overlap = edgeOverlapLength(movedA, edgeB, edgeBDir);
          const minLen = Math.min(edgeLength(movedA), edgeLength(edgeB));
          if (overlap < minLen - CONFIG.snap.edgeDistCm) {
            return;
          }
          if (overlap < CONFIG.snap.edgeOverlapCm) {
            return;
          }
          const candidate = { translation, distance, rotation, assist };
          if (!best || assist < best.assist || (Math.abs(assist - best.assist) < 1e-6 && Math.abs(rotation) < Math.abs(best.rotation))) {
            best = candidate;
          }
        });
      });
    });
    return best;
  }

  function buildVertexClusters(tiles, eps) {
    // Collect all vertices with grid cell keys
    const allEntries = [];
    tiles.forEach((tile) => {
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      for (let i = 0; i < poly.length; i += 1) {
        const point = poly[i];
        allEntries.push({
          point,
          angle: tile.vertexAngles[i],
          tileId: tile.id,
          cx: Math.floor(point.x / eps),
          cy: Math.floor(point.y / eps)
        });
      }
    });

    // Build grid for fast neighbor lookup
    const grid = new Map();
    allEntries.forEach((entry, idx) => {
      const key = `${entry.cx},${entry.cy}`;
      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key).push(idx);
    });

    // Union-Find to merge nearby vertices across cell boundaries
    const parent = allEntries.map((_, i) => i);
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // Check each entry against entries in adjacent 9 cells
    allEntries.forEach((entry, idx) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const key = `${entry.cx + dx},${entry.cy + dy}`;
          const bucket = grid.get(key);
          if (!bucket) continue;
          bucket.forEach((otherIdx) => {
            if (otherIdx <= idx) return;
            const other = allEntries[otherIdx];
            const dist = Math.hypot(entry.point.x - other.point.x, entry.point.y - other.point.y);
            if (dist <= eps) {
              union(idx, otherIdx);
            }
          });
        }
      }
    });

    // Group by cluster root
    const clusters = new Map();
    allEntries.forEach((entry, idx) => {
      const root = find(idx);
      if (!clusters.has(root)) {
        clusters.set(root, []);
      }
      clusters.get(root).push(entry);
    });

    return Array.from(clusters.values()).map((entries) => {
      const center = entries.reduce((acc, entry) => add(acc, entry.point), { x: 0, y: 0 });
      const count = entries.length || 1;
      const angleSum = entries.reduce((sum, entry) => sum + entry.angle, 0);
      return {
        center: scale(center, 1 / count),
        angleSum,
        entries
      };
    });
  }

  function chooseClusterTarget(entries) {
    if (!entries.length) {
      return null;
    }
    let best = entries[0].point;
    let bestScore = Infinity;
    entries.forEach((entry) => {
      let score = 0;
      entries.forEach((other) => {
        score += Math.hypot(entry.point.x - other.point.x, entry.point.y - other.point.y);
      });
      if (score < bestScore) {
        bestScore = score;
        best = entry.point;
      }
    });
    return best;
  }

  function alignVertexClustersToExact() {
    if (state.tiles.length < 2) {
      return false;
    }
    const clusters = buildVertexClusters(state.tiles, CONFIG.snap.maxAssistCm);
    if (clusters.length === 0) {
      return false;
    }
    const groups = buildGroupsFromConnections();
    const groupByTile = new Map();
    groups.forEach((group, index) => {
      group.forEach((id) => {
        groupByTile.set(id, { id: index, ids: group });
      });
    });
    let moved = false;
    clusters.forEach((cluster) => {
      const angleDeg = radToDeg(cluster.angleSum);
      if (Math.abs(angleDeg - 360) > CONFIG.snap.vertexSumDeg) {
        return;
      }
      const target = chooseClusterTarget(cluster.entries);
      if (!target) {
        return;
      }
      const groupMoves = new Map();
      cluster.entries.forEach((entry) => {
        const group = groupByTile.get(entry.tileId);
        if (!group) {
          return;
        }
        const delta = sub(target, entry.point);
        const distance = Math.hypot(delta.x, delta.y);
        if (distance < 1e-6 || distance > CONFIG.snap.maxAssistCm) {
          return;
        }
        const existing = groupMoves.get(group.id);
        if (!existing || distance < existing.distance) {
          groupMoves.set(group.id, { ids: group.ids, delta, distance });
        }
      });
      groupMoves.forEach((move) => {
        const newPositions = new Map();
        move.ids.forEach((id) => {
          const tile = findTileById(id);
          newPositions.set(id, add(tile.pos, move.delta));
        });
        if (!isGroupPlacementValid(move.ids, newPositions)) {
          return;
        }
        move.ids.forEach((id) => {
          const tile = findTileById(id);
          tile.pos = newPositions.get(id);
        });
        moved = true;
      });
    });
    return moved;
  }

  function weldSharedVertices() {
    if (state.tiles.length < 2) {
      return;
    }
    const eps = CONFIG.snap.edgeDistCm;

    // Build groups from connections so we know which tiles are linked
    const groups = buildGroupsFromConnections();
    const groupByTile = new Map();
    groups.forEach((group, index) => {
      group.forEach((id) => {
        groupByTile.set(id, index);
      });
    });

    // For each connected pair of tiles, find shared edge endpoints and weld
    const processed = new Set();
    state.connections.forEach((neighbors, tileId) => {
      neighbors.forEach((neighborId) => {
        const pairKey = tileId < neighborId ? `${tileId}|${neighborId}` : `${neighborId}|${tileId}`;
        if (processed.has(pairKey)) return;
        processed.add(pairKey);

        const tileA = findTileById(tileId);
        const tileB = findTileById(neighborId);
        if (!tileA || !tileB) return;

        const polyA = transformPolygon(tileA.basePoly, tileA.pos, tileA.rot);
        const polyB = transformPolygon(tileB.basePoly, tileB.pos, tileB.rot);

        // Find matching vertex pairs (vertices that should be at the same position)
        for (let i = 0; i < polyA.length; i += 1) {
          for (let j = 0; j < polyB.length; j += 1) {
            const dist = Math.hypot(polyA[i].x - polyB[j].x, polyA[i].y - polyB[j].y);
            if (dist > eps || dist < 1e-10) continue;

            // These two vertices should be at the same position
            // Move the tile that belongs to the smaller group toward the larger group's vertex
            const groupA = groupByTile.get(tileId);
            const groupB = groupByTile.get(neighborId);
            const sizeA = groups[groupA] ? groups[groupA].length : 1;
            const sizeB = groups[groupB] ? groups[groupB].length : 1;

            let target, moverTile, moverGroupIds;
            if (sizeA >= sizeB) {
              target = polyA[i];
              moverTile = tileB;
              moverGroupIds = groupA !== groupB ? [neighborId] : null;
            } else {
              target = polyB[j];
              moverTile = tileA;
              moverGroupIds = groupA !== groupB ? [tileId] : null;
            }

            if (!moverGroupIds) continue;

            const moverPoly = transformPolygon(moverTile.basePoly, moverTile.pos, moverTile.rot);
            const moverVertexIdx = moverTile === tileB ? j : i;
            const delta = sub(target, moverPoly[moverVertexIdx]);
            if (Math.hypot(delta.x, delta.y) < 1e-10) continue;

            // Move the entire group of the mover tile
            const moverGroup = groups[groupByTile.get(moverTile.id)] || [moverTile.id];
            moverGroup.forEach((id) => {
              const t = findTileById(id);
              if (t) {
                t.pos = add(t.pos, delta);
              }
            });
          }
        }
      });
    });
  }

  function findVertexSnapCandidates(tile, clusters) {
    const candidates = [];
    for (let i = 0; i < tile.basePoly.length; i += 1) {
      const vertex = transformPoint(tile.basePoly[i], tile.pos, tile.rot);
      const angle = tile.vertexAngles[i];
      clusters.forEach((cluster) => {
        const totalDeg = radToDeg(cluster.angleSum + angle);
        if (Math.abs(totalDeg - 360) > CONFIG.snap.vertexSumDeg) {
          return;
        }
        cluster.entries.forEach((entry) => {
          const dx = entry.point.x - vertex.x;
          const dy = entry.point.y - vertex.y;
          const distance = Math.hypot(dx, dy);
          if (distance > CONFIG.snap.maxAssistCm) {
            return;
          }
          candidates.push({ translation: { x: dx, y: dy }, distance, rotation: 0, assist: distance });
        });
      });
    }
    return candidates;
  }

  function findBestSnapTranslation(tile, tiles, allowRotation) {
    const candidates = [];
    tiles.forEach((other) => {
      const edgeSnap = findEdgeSnap(tile, other, allowRotation);
      if (edgeSnap) {
        candidates.push(edgeSnap);
      }
    });

    const clusters = buildVertexClusters(tiles, CONFIG.snap.maxAssistCm);
    candidates.push(...findVertexSnapCandidates(tile, clusters));

    candidates.sort((a, b) => (a.assist ?? a.distance) - (b.assist ?? b.distance));
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const testTile = {
        ...tile,
        rot: tile.rot + (candidate.rotation || 0),
        pos: add(tile.pos, candidate.translation)
      };
      if (isTilePlacementValid(testTile, [])) {
        return candidate;
      }
    }
    return null;
  }

  function snapGroupToConnections(ids) {
    const translation = findBestGroupSnapTranslation(ids);
    if (!translation) {
      return false;
    }
    ids.forEach((id) => {
      const tile = findTileById(id);
      tile.pos = add(tile.pos, translation);
    });
    return true;
  }

  function findBestGroupSnapTranslation(ids) {
    const idSet = new Set(ids);
    const others = state.tiles.filter((tile) => !idSet.has(tile.id));
    if (others.length === 0) {
      return null;
    }
    const candidates = [];
    
    const clusters = buildVertexClusters(others, CONFIG.snap.maxAssistCm);
    ids.forEach((id) => {
      const tile = findTileById(id);
      if (!tile) {
        return;
      }
      candidates.push(...findVertexSnapCandidates(tile, clusters));
    });

    candidates.sort((a, b) => (a.assist ?? a.distance) - (b.assist ?? b.distance));
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const newPositions = new Map();
      ids.forEach((id) => {
        const tile = findTileById(id);
        newPositions.set(id, add(tile.pos, candidate.translation));
      });
      if (!isGroupPlacementValid(ids, newPositions)) {
        continue;
      }
      if (!groupTranslationCreatesConnection(ids, newPositions, idSet)) {
        continue;
      }
      return candidate.translation;
    }
    return null;
  }

  function groupTranslationCreatesConnection(ids, newPositions, idSet) {
    const tempTiles = state.tiles.map((tile) => {
      if (!idSet.has(tile.id)) {
        return tile;
      }
      return { ...tile, pos: newPositions.get(tile.id) };
    });
    const connections = computeConnections(tempTiles);
    return ids.some((id) => {
      const neighbors = connections.get(id);
      if (!neighbors) {
        return false;
      }
      for (const neighborId of neighbors) {
        if (!idSet.has(neighborId)) {
          return true;
        }
      }
      return false;
    });
  }

  function edgeConnectionAllowed(tileA, tileB) {
    if (tileA.isNeutral || tileB.isNeutral) {
      return true;
    }
    if (tileA.ownerId == null || tileB.ownerId == null) {
      return false;
    }
    return tileA.ownerId === tileB.ownerId;
  }

  function edgeOverlapLength(edgeA, edgeB, dirB) {
    const a1 = dot(sub(edgeA.a, edgeB.a), dirB);
    const a2 = dot(sub(edgeA.b, edgeB.a), dirB);
    const b1 = 0;
    const b2 = dot(sub(edgeB.b, edgeB.a), dirB);
    const minA = Math.min(a1, a2);
    const maxA = Math.max(a1, a2);
    const minB = Math.min(b1, b2);
    const maxB = Math.max(b1, b2);
    return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
  }

  function edgeLength(edge) {
    return Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
  }

  function minEdgeLength(points) {
    if (!points || points.length < 2) {
      return Infinity;
    }
    let minLen = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > 1e-6) {
        minLen = Math.min(minLen, length);
      }
    }
    return minLen;
  }

  function updateMaxAssistFromAssets() {
    let minLen = Infinity;
    state.availableTiles.forEach((tileId) => {
      const def = CONFIG.tileDefs[tileId];
      if (!def || !def.basePoly) {
        return;
      }
      minLen = Math.min(minLen, minEdgeLength(def.basePoly));
    });
    if (!Number.isFinite(minLen) || minLen === Infinity) {
      return;
    }
    const assist = clamp(minLen * 0.25, 0.2, minLen * 0.6);
    CONFIG.snap.maxAssistCm = assist;
  }

  // attemptMoveGroup is removed (drag is now fully continuous)

  function attemptMoveGroup(ids, delta) {
    const distance = Math.hypot(delta.x, delta.y);
    if (distance < 1e-4) return;
    
    const stepCount = Math.ceil(distance / 5);
    const stepX = delta.x / stepCount;
    const stepY = delta.y / stepCount;

    let validPositions = new Map();
    ids.forEach(id => validPositions.set(id, findTileById(id).pos));

    for (let i = 0; i < stepCount; i += 1) {
      const nextPositions = new Map();
      ids.forEach(id => {
        const p = validPositions.get(id);
        nextPositions.set(id, add(p, { x: stepX, y: stepY }));
      });
      
      if (isGroupPlacementValid(ids, nextPositions)) {
        validPositions = nextPositions;
      } else {
        const nextPosX = new Map();
        ids.forEach(id => nextPosX.set(id, add(validPositions.get(id), { x: stepX, y: 0 })));
        if (stepX !== 0 && isGroupPlacementValid(ids, nextPosX)) {
          validPositions = nextPosX;
          continue;
        }
        
        const nextPosY = new Map();
        ids.forEach(id => nextPosY.set(id, add(validPositions.get(id), { x: 0, y: stepY })));
        if (stepY !== 0 && isGroupPlacementValid(ids, nextPosY)) {
          validPositions = nextPosY;
          continue;
        }
        break;
      }
    }
    
    ids.forEach(id => {
      const tile = findTileById(id);
      tile.pos = validPositions.get(id);
    });
  }

  function rotateGroupElements(ids, angle) {
    const pivot = groupCentroid(ids);
    const newPositions = new Map();
    ids.forEach((id) => {
      const tile = findTileById(id);
      newPositions.set(id, rotateAround(tile.pos, pivot, angle));
    });
    if (!isGroupPlacementValid(ids, newPositions, angle)) {
      return false;
    }
    ids.forEach((id) => {
      const tile = findTileById(id);
      tile.pos = newPositions.get(id);
      tile.rot += angle;
    });
    return true;
  }

  function groupCentroid(ids) {
    let sumX = 0;
    let sumY = 0;
    ids.forEach((id) => {
      const tile = findTileById(id);
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      const centroid = polygonCentroid(poly);
      sumX += centroid.x;
      sumY += centroid.y;
    });
    const count = ids.length || 1;
    return { x: sumX / count, y: sumY / count };
  }

  function getTileGroup(tileId) {
    const tile = findTileById(tileId);
    if (!tile) return [];
    return state.tiles.filter(t => t.groupId === tile.groupId).map(t => t.id);
  }

  function updateConnections() {
    state.connections = computeConnections(state.tiles);
  }

  function computeConnections(tiles) {
    const connections = new Map();
    tiles.forEach((tile) => connections.set(tile.id, new Set()));

    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        if (edgeConnectionExists(tiles[i], tiles[j])) {
          connections.get(tiles[i].id).add(tiles[j].id);
          connections.get(tiles[j].id).add(tiles[i].id);
        }
      }
    }

    const clusters = clusterVertices(tiles, CONFIG.snap.vertexDistCm);
    clusters.forEach((cluster) => {
      const angleSum = cluster.reduce((sum, entry) => sum + entry.angle, 0);
      const angleDeg = radToDeg(angleSum);
      if (Math.abs(angleDeg - 360) <= CONFIG.snap.vertexSumDeg) {
        cluster.forEach((a) => {
          cluster.forEach((b) => {
            if (a.tileId !== b.tileId) {
              connections.get(a.tileId).add(b.tileId);
            }
          });
        });
      }
    });

    return connections;
  }

  function edgeConnectionExists(tileA, tileB) {
    if (!edgeConnectionAllowed(tileA, tileB)) {
      return false;
    }
    const polyA = transformPolygon(tileA.basePoly, tileA.pos, tileA.rot);
    const polyB = transformPolygon(tileB.basePoly, tileB.pos, tileB.rot);
    const edgesA = polygonEdges(polyA);
    const edgesB = polygonEdges(polyB);
    const angleTol = Math.cos(degToRad(CONFIG.snap.edgeAngleDeg));

    for (let i = 0; i < edgesA.length; i += 1) {
      const edgeA = edgesA[i];
      const dirA = normalize(sub(edgeA.b, edgeA.a));
      for (let j = 0; j < edgesB.length; j += 1) {
        const edgeB = edgesB[j];
        const dirB = normalize(sub(edgeB.b, edgeB.a));
        const dotValue = dirA.x * dirB.x + dirA.y * dirB.y;
        if (dotValue > -angleTol) {
          continue;
        }
        const midA = scale(add(edgeA.a, edgeA.b), 0.5);
        const distance = pointLineDistance(midA, edgeB.a, edgeB.b);
        if (distance > CONFIG.snap.edgeDistCm) {
          continue;
        }
        const overlap = edgeOverlapLength(edgeA, edgeB, dirB);
        const minLen = Math.min(edgeLength(edgeA), edgeLength(edgeB));
        if (overlap < minLen - CONFIG.snap.edgeDistCm) {
          continue;
        }
        if (overlap < CONFIG.snap.edgeOverlapCm) {
          continue;
        }
        return true;
      }
    }

    return false;
  }

  function clusterVertices(tiles, eps) {
    // Collect all vertices with grid cell keys
    const allEntries = [];
    tiles.forEach((tile) => {
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      for (let i = 0; i < poly.length; i += 1) {
        const point = poly[i];
        allEntries.push({
          tileId: tile.id,
          point,
          angle: tile.vertexAngles[i],
          cx: Math.floor(point.x / eps),
          cy: Math.floor(point.y / eps)
        });
      }
    });

    // Build grid for fast neighbor lookup
    const grid = new Map();
    allEntries.forEach((entry, idx) => {
      const key = `${entry.cx},${entry.cy}`;
      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key).push(idx);
    });

    // Union-Find to merge nearby vertices across cell boundaries
    const parent = allEntries.map((_, i) => i);
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // Check adjacent 9 cells for nearby vertices
    allEntries.forEach((entry, idx) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const key = `${entry.cx + dx},${entry.cy + dy}`;
          const bucket = grid.get(key);
          if (!bucket) continue;
          bucket.forEach((otherIdx) => {
            if (otherIdx <= idx) return;
            const other = allEntries[otherIdx];
            const dist = Math.hypot(entry.point.x - other.point.x, entry.point.y - other.point.y);
            if (dist <= eps) {
              union(idx, otherIdx);
            }
          });
        }
      }
    });

    // Group by cluster root
    const clusters = new Map();
    allEntries.forEach((entry, idx) => {
      const root = find(idx);
      if (!clusters.has(root)) {
        clusters.set(root, []);
      }
      clusters.get(root).push(entry);
    });

    return Array.from(clusters.values()).filter((cluster) => cluster.length > 1);
  }

  function checkBridgeWins() {
    if (state.mode !== 'bridge') {
      return;
    }
    const groups = buildGroupsFromConnections();
    let anyFinished = false;
    state.players.forEach((player) => {
      if (player.finished || player.regions.length < 2) {
        return;
      }
      const regionPolys = player.regions.map((index) => state.board.regions[index].polygon);
      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        const touches = regionPolys.map((poly) => groupTouchesRegion(group, poly));
        if (touches.every(Boolean)) {
          player.finished = true;
          anyFinished = true;
          if (!state.bridgeRankings) state.bridgeRankings = [];
          state.bridgeRankings.push(player);
          const rank = state.bridgeRankings.length;
          appendLog(`${player.name}이(가) 브릿지를 완성했습니다! (${rank}등)`);
          setStatus(`${player.name}이(가) 브릿지를 완성했습니다! (${rank}등)`);
          break;
        }
      }
    });
    if (anyFinished) {
      state.passStreak = 0;
    }
    if (state.mode === 'bridge' && activePlayerCount() === 0) {
      finishBridge();
    }
    updateUiState();
  }

  function buildGroupsFromConnections() {
    const groupMap = new Map();
    state.tiles.forEach(tile => {
      if (!groupMap.has(tile.groupId)) groupMap.set(tile.groupId, []);
      groupMap.get(tile.groupId).push(tile.id);
    });
    return Array.from(groupMap.values());
  }

  function groupTouchesRegion(group, regionPoly) {
    for (let i = 0; i < group.length; i += 1) {
      const tile = findTileById(group[i]);
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      if (polygonsOverlap(poly, regionPoly, CONFIG.snap.collisionEpsCm)) {
        return true;
      }
    }
    return false;
  }

  function isTilePlacementValid(tile, ignoreIds) {
    const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
    if (!polygonInsidePolygon(poly, state.board.polygon)) {
      return false;
    }
    for (let i = 0; i < state.obstacles.length; i += 1) {
      const obstacle = state.obstacles[i];
      const obsPoly = transformPolygon(obstacle.basePoly, obstacle.pos, obstacle.rot);
      if (polygonsOverlap(poly, obsPoly, CONFIG.snap.collisionEpsCm)) {
        return false;
      }
    }
    for (let i = 0; i < state.tiles.length; i += 1) {
      const other = state.tiles[i];
      if (ignoreIds.includes(other.id)) {
        continue;
      }
      const otherPoly = transformPolygon(other.basePoly, other.pos, other.rot);
      if (polygonsOverlap(poly, otherPoly, CONFIG.snap.collisionEpsCm)) {
        return false;
      }
    }
    return true;
  }

  function isObstaclePlacementValid(obstacle, ignoreId) {
    const poly = transformPolygon(obstacle.basePoly, obstacle.pos, obstacle.rot);
    if (!polygonInsidePolygon(poly, state.board.polygon)) {
      return false;
    }
    for (let i = 0; i < state.obstacles.length; i += 1) {
      const other = state.obstacles[i];
      if (other.id === ignoreId) {
        continue;
      }
      const otherPoly = transformPolygon(other.basePoly, other.pos, other.rot);
      if (polygonsOverlap(poly, otherPoly, CONFIG.snap.collisionEpsCm)) {
        return false;
      }
    }
    return true;
  }

  function isGroupPlacementValid(ids, newPositions, rotationDelta = 0) {
    const movedPolys = new Map();
    for (let i = 0; i < ids.length; i += 1) {
      const tile = findTileById(ids[i]);
      const pos = newPositions.get(ids[i]);
      const poly = transformPolygon(tile.basePoly, pos, tile.rot + rotationDelta);
      if (!polygonInsidePolygon(poly, state.board.polygon)) {
        return false;
      }
      movedPolys.set(ids[i], poly);
    }
    for (let i = 0; i < state.obstacles.length; i += 1) {
      const obstacle = state.obstacles[i];
      const obsPoly = transformPolygon(obstacle.basePoly, obstacle.pos, obstacle.rot);
      for (const poly of movedPolys.values()) {
        if (polygonsOverlap(poly, obsPoly, CONFIG.snap.collisionEpsCm)) {
          return false;
        }
      }
    }
    for (let i = 0; i < state.tiles.length; i += 1) {
      const other = state.tiles[i];
      if (ids.includes(other.id)) {
        continue;
      }
      const otherPoly = transformPolygon(other.basePoly, other.pos, other.rot);
      for (const poly of movedPolys.values()) {
        if (polygonsOverlap(poly, otherPoly, CONFIG.snap.collisionEpsCm)) {
          return false;
        }
      }
    }
    return true;
  }

  function isTileInPlayerRegion(tile, player) {
    if (!player) {
      return false;
    }
    const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
    for (let i = 0; i < player.regions.length; i += 1) {
      const region = state.board.regions[player.regions[i]].polygon;
      if (polygonsOverlap(poly, region, CONFIG.snap.collisionEpsCm)) {
        return true;
      }
    }
    return false;
  }

  function trySpiralPlacement(tile, ignoreIds) {
    const step = 0.2;
    const maxRadius = state.board ? state.board.sideCm * 2 : 10;
    for (let r = step; r < maxRadius; r += step) {
      for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
        tile.pos = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
        if (isTilePlacementValid(tile, ignoreIds)) {
          return true;
        }
      }
    }
    return false;
  }

  function findTileAtPoint(point) {
    for (let i = state.tiles.length - 1; i >= 0; i -= 1) {
      const tile = state.tiles[i];
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      if (pointInPolygon(point, poly)) {
        return tile.id;
      }
    }
    return null;
  }

  function findObstacleAtPoint(point) {
    for (let i = state.obstacles.length - 1; i >= 0; i -= 1) {
      const obstacle = state.obstacles[i];
      const poly = transformPolygon(obstacle.basePoly, obstacle.pos, obstacle.rot);
      if (pointInPolygon(point, poly)) {
        return obstacle.id;
      }
    }
    return null;
  }

  function findRegionAtPoint(point) {
    if (!state.board) {
      return null;
    }
    for (let i = 0; i < state.board.regions.length; i += 1) {
      const region = state.board.regions[i];
      if (pointInPolygon(point, region.polygon)) {
        return i;
      }
    }
    return null;
  }

  function findTileById(id) {
    return state.tiles.find((tile) => tile.id === id);
  }

  function findObstacleById(id) {
    return state.obstacles.find((obstacle) => obstacle.id === id);
  }

  function removeObstacle(id) {
    const index = state.obstacles.findIndex((obstacle) => obstacle.id === id);
    if (index === -1) {
      return;
    }
    const obstacle = state.obstacles[index];
    state.obstacles.splice(index, 1);
    state.obstaclePool[obstacle.typeId] += 1;
    state.selected = null;
    updateUiState();
    appendLog(`${obstacleLabel(obstacle.typeId)} 제거됨.`);
  }

  function getCurrentPlayer() {
    if (state.turnOrder.length === 0) {
      return null;
    }
    const playerId = state.turnOrder[state.turnPointer];
    return state.players[playerId];
  }

  function activePlayerCount() {
    return state.players.filter((player) => !player.finished).length;
  }

  function countRemainingTiles(player) {
    return Object.values(player.inventory || {}).reduce((sum, value) => sum + (value || 0), 0);
  }

  function render() {
    const ctx = ui.ctx;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    drawBoard(ctx);
    drawRegions(ctx);
    drawObstacles(ctx);
    drawTiles(ctx);
    if (state.dragging && state.dragging.type === 'ghost') {
      drawGhost(ctx, state.dragging.tile, state.dragging.isValid);
    }
    drawRotationHandle(ctx);
    requestAnimationFrame(render);
  }

  function drawBoard(ctx) {
    if (!state.board) {
      return;
    }
    drawPolygonWorld(ctx, state.board.polygon, '#f8f2e4', '#bda980', 1.2);
  }

  function drawRegions(ctx) {
    if (!state.board) {
      return;
    }
    const highlight = state.phase === 'setup' && state.setupStep === 'regions';
    state.board.regions.forEach((region) => {
      let fill = 'rgba(15, 118, 110, 0.08)';
      if (region.ownerId != null) {
        const player = state.players[region.ownerId];
        fill = hexToRgba(player.color, 0.18);
      }
      if (highlight && region.ownerId == null) {
        fill = 'rgba(0, 0, 0, 0.05)';
      }
      drawPolygonWorld(ctx, region.polygon, fill, 'rgba(0,0,0,0.08)', 1);
    });
  }

  function drawObstacles(ctx) {
    state.obstacles.forEach((obstacle) => {
      const poly = transformPolygon(obstacle.basePoly, obstacle.pos, obstacle.rot);
      drawPolygonWorld(ctx, poly, '#4b5563', '#1f2937', 1.1);
    });
  }

  function drawTiles(ctx) {
    state.tiles.forEach((tile) => {
      const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
      let fill = '#9ca3af';
      let stroke = '#4b5563';
      if (!tile.isNeutral && tile.ownerId != null) {
        const player = state.players[tile.ownerId];
        fill = player ? hexToRgba(player.color, 0.85) : '#9ca3af';
        stroke = player ? player.color : '#4b5563';
      }
      const isDragging = state.dragging && state.dragging.type === 'tileGroup' && state.dragging.ids.includes(tile.id);
      if (isDragging && state.dragging.isValid === false) {
        fill = 'rgba(220, 38, 38, 0.25)';
        stroke = '#dc2626';
      }
      const selected = state.selected && state.selected.type === 'tileGroup' && state.selected.ids.includes(tile.id);
      drawPolygonWorld(ctx, poly, fill, stroke, selected ? 2.4 : 1.2);
    });
  }

  function drawGhost(ctx, tile, isValid) {
    const poly = transformPolygon(tile.basePoly, tile.pos, tile.rot);
    const fill = isValid ? 'rgba(14, 116, 144, 0.25)' : 'rgba(220, 38, 38, 0.25)';
    const stroke = isValid ? '#0e7490' : '#dc2626';
    drawPolygonWorld(ctx, poly, fill, stroke, 1.4);
  }

  function drawRotationHandle(ctx) {
    if (!state.selected || state.selected.type !== 'tileGroup') {
      state.rotationHandlePos = null;
      return;
    }
    const pivot = groupCentroid(state.selected.ids);
    const topPoint = { x: pivot.x, y: pivot.y - 2.5 };
    const screenPivot = worldToScreen(pivot);
    const screenTop = worldToScreen(topPoint);
    
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPivot.x, screenPivot.y);
    ctx.lineTo(screenTop.x, screenTop.y);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.beginPath();
    ctx.arc(screenTop.x, screenTop.y, 8, 0, Math.PI * 2);
    const isDragging = state.dragging && state.dragging.type === 'rotateGroup';
    ctx.fillStyle = isDragging && !state.dragging.isValid ? '#ef4444' : '#10b981';
    ctx.fill();
    ctx.strokeStyle = isDragging && !state.dragging.isValid ? '#991b1b' : '#064e3b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    
    state.rotationHandlePos = screenTop;
  }

  function drawPolygonWorld(ctx, poly, fill, stroke, lineWidth) {
    const points = poly.map(worldToScreen);
    ctx.save();
    ctx.beginPath();
    points.forEach((p, index) => {
      if (index === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lineWidth * (state.view.dpr || 1);
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }

  function screenToWorld(event) {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = state.view.dpr || 1;
    const x = (event.clientX - rect.left) * dpr;
    const y = (event.clientY - rect.top) * dpr;
    return {
      x: (x - state.view.offset.x) / state.view.scale,
      y: (y - state.view.offset.y) / state.view.scale
    };
  }

  function worldToScreen(point) {
    return {
      x: point.x * state.view.scale + state.view.offset.x,
      y: point.y * state.view.scale + state.view.offset.y
    };
  }

  function transformPolygon(points, pos, rot) {
    return points.map((p) => {
      const rotated = rotate(p, rot);
      return add(rotated, pos);
    });
  }

  function transformPoint(point, pos, rot) {
    return add(rotate(point, rot), pos);
  }

  function rotateAround(point, pivot, angle) {
    const relative = sub(point, pivot);
    return add(rotate(relative, angle), pivot);
  }

  function angleBetween(a, b) {
    return Math.atan2(cross(a, b), dot(a, b));
  }

  function closestPointOnSegment(point, a, b) {
    const ab = sub(b, a);
    const t = clamp(dot(sub(point, a), ab) / Math.max(1e-6, dot(ab, ab)), 0, 1);
    return add(a, scale(ab, t));
  }

  function polygonEdges(points) {
    const edges = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      edges.push({ a, b });
    }
    return edges;
  }

  function polygonsIntersect(polyA, polyB, epsilon = 0) {
    if (polygonsHaveEdgeIntersection(polyA, polyB, epsilon)) {
      return true;
    }
    if (pointInPolygon(polyA[0], polyB)) {
      return true;
    }
    if (pointInPolygon(polyB[0], polyA)) {
      return true;
    }
    return false;
  }

  function polygonsOverlap(polyA, polyB, epsilon = 0) {
    if (polygonsHaveProperIntersection(polyA, polyB, epsilon)) {
      return true;
    }
    for (let i = 0; i < polyA.length; i += 1) {
      if (pointInPolygonStrict(polyA[i], polyB, epsilon)) {
        return true;
      }
    }
    for (let i = 0; i < polyB.length; i += 1) {
      if (pointInPolygonStrict(polyB[i], polyA, epsilon)) {
        return true;
      }
    }
    return false;
  }

  function polygonsHaveEdgeIntersection(polyA, polyB, epsilon) {
    for (let i = 0; i < polyA.length; i += 1) {
      const a1 = polyA[i];
      const a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j += 1) {
        const b1 = polyB[j];
        const b2 = polyB[(j + 1) % polyB.length];
        if (segmentsIntersectInclusive(a1, a2, b1, b2, epsilon)) {
          return true;
        }
      }
    }
    return false;
  }

  function polygonsHaveProperIntersection(polyA, polyB, epsilon) {
    for (let i = 0; i < polyA.length; i += 1) {
      const a1 = polyA[i];
      const a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j += 1) {
        const b1 = polyB[j];
        const b2 = polyB[(j + 1) % polyB.length];
        if (segmentsProperlyIntersect(a1, a2, b1, b2, epsilon)) {
          return true;
        }
      }
    }
    return false;
  }

  function segmentsIntersectInclusive(a, b, c, d, epsilon) {
    const o1 = orientation(a, b, c, epsilon);
    const o2 = orientation(a, b, d, epsilon);
    const o3 = orientation(c, d, a, epsilon);
    const o4 = orientation(c, d, b, epsilon);

    if (o1 !== o2 && o3 !== o4) {
      return true;
    }
    if (o1 === 0 && pointOnSegment(a, b, c, epsilon)) {
      return true;
    }
    if (o2 === 0 && pointOnSegment(a, b, d, epsilon)) {
      return true;
    }
    if (o3 === 0 && pointOnSegment(c, d, a, epsilon)) {
      return true;
    }
    if (o4 === 0 && pointOnSegment(c, d, b, epsilon)) {
      return true;
    }
    return false;
  }

  function segmentsProperlyIntersect(a, b, c, d, epsilon) {
    const o1 = orientation(a, b, c, epsilon);
    const o2 = orientation(a, b, d, epsilon);
    const o3 = orientation(c, d, a, epsilon);
    const o4 = orientation(c, d, b, epsilon);
    return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
  }

  function orientation(a, b, c, epsilon) {
    const value = cross(sub(b, a), sub(c, a));
    if (Math.abs(value) <= epsilon) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  }

  function pointOnSegment(a, b, p, epsilon) {
    return (
      p.x >= Math.min(a.x, b.x) - epsilon &&
      p.x <= Math.max(a.x, b.x) + epsilon &&
      p.y >= Math.min(a.y, b.y) - epsilon &&
      p.y <= Math.max(a.y, b.y) + epsilon &&
      distancePointToSegment(p, a, b) <= epsilon
    );
  }

  function pointInPolygonStrict(point, poly, epsilon) {
    if (!pointInPolygon(point, poly)) {
      return false;
    }
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (distancePointToSegment(point, a, b) <= epsilon) {
        return false;
      }
    }
    return true;
  }

  function polygonInsidePolygon(poly, container) {
    for (let i = 0; i < poly.length; i += 1) {
      if (!pointInPolygon(poly[i], container)) {
        return false;
      }
    }
    return true;
  }

  function pointInPolygon(point, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersect = yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  function computeInternalAngles(points) {
    const angles = [];
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length];
      const curr = points[i];
      const next = points[(i + 1) % points.length];
      const v1 = normalize(sub(prev, curr));
      const v2 = normalize(sub(next, curr));
      const angle = Math.acos(clamp(dot(v1, v2), -1, 1));
      angles.push(angle);
    }
    return angles;
  }

  function pointLineDistance(point, a, b) {
    const ab = sub(b, a);
    const ap = sub(point, a);
    const area = Math.abs(ab.x * ap.y - ab.y * ap.x);
    const length = Math.max(1e-6, Math.sqrt(ab.x * ab.x + ab.y * ab.y));
    return area / length;
  }

  function distancePointToSegment(point, a, b) {
    const ab = sub(b, a);
    const t = clamp(dot(sub(point, a), ab) / Math.max(1e-6, dot(ab, ab)), 0, 1);
    const proj = add(a, scale(ab, t));
    return Math.hypot(point.x - proj.x, point.y - proj.y);
  }

  function projectPointToLine(point, a, b) {
    const ab = sub(b, a);
    const t = dot(sub(point, a), ab) / Math.max(1e-6, dot(ab, ab));
    return add(a, scale(ab, t));
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function radToDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function normalizeAngle(angle) {
    let result = angle;
    while (result < 0) {
      result += 2 * Math.PI;
    }
    while (result >= 2 * Math.PI) {
      result -= 2 * Math.PI;
    }
    return result;
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  function scale(a, s) {
    return { x: a.x * s, y: a.y * s };
  }

  function rotate(point, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function cross(a, b) {
    return a.x * b.y - a.y * b.x;
  }

  function normalize(a) {
    const length = Math.hypot(a.x, a.y);
    if (length < 1e-6) {
      return { x: 0, y: 0 };
    }
    return { x: a.x / length, y: a.y / length };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fileDisplayName(path) {
    if (!path) {
      return '';
    }
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
  }

  function tileLabel(tileId) {
    const def = CONFIG.tileDefs[tileId];
    return def?.displayName || def?.name || tileId;
  }

  function obstacleLabel(obstacleId) {
    const def = CONFIG.obstacleDefs[obstacleId];
    return def?.displayName || def?.name || obstacleId;
  }

  function hexToRgba(hex, alpha) {
    const sanitized = hex.replace('#', '');
    const value = parseInt(sanitized, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
})();
