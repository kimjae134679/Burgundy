import http from 'node:http';
import crypto from 'node:crypto';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createInitialGame, applyGameCommand, driveAI, GameCommandError, summarizeState } from './server_game_engine.mjs';
import {normalizeDuchyMode, ACTIVE_DUCHY_MODES, buildDuchyAssignments, isValidStartCastleIndex, chooseStartCastleIndex} from './duchy_assignment.mjs';

let hubCtx=null;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SERVER_VERSION = '26.1-cloudflare';

/** @type {Map<string, any>} */
const rooms = new Map();
/** @type {Map<string, {clientId:string,name:string,roomCode:string|null,streams:Set<any>,disconnectTimer:any}>} */
const sessions = new Map();

const parseJSON = s => { try { return JSON.parse(s); } catch { return null; } };

function serializeRooms(){
  return [...rooms.values()].map(r=>{const {clients,...rest}=r;return rest;});
}
function scheduleSave(){
  if(!hubCtx)return;
  const p=hubCtx.storage.put('rooms',serializeRooms());
  try{hubCtx.waitUntil(p)}catch{}
}
function saveRooms(){scheduleSave()}
function touch(room) { room.updatedAt = Date.now(); scheduleSave(); }
function audit(room, item){ room.audit ||= []; room.audit.push({at:Date.now(),...item}); room.audit=room.audit.slice(-120); }

function makeCode() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let t=0;t<100;t++){
    let c='';for(let i=0;i<6;i++)c+=alphabet[crypto.randomInt(alphabet.length)];
    if(!rooms.has(c))return c;
  }
  return crypto.randomUUID().slice(0,6).toUpperCase();
}
function publicRoom(room) {
  return {code:room.code,name:room.name,maxPlayers:room.maxPlayers,difficulty:room.difficulty,duchyId:room.duchyId||1,duchyMode:room.duchyMode||'beginner_same',startCastleMode:room.startCastleMode||'recommended',duchyAssignments:room.duchyAssignments||null,isPublic:room.isPublic!==false,hostId:room.hostId,
    gameStarted:room.gameStarted,gameOver:!!room.gameState?.gameOver,matchNumber:room.matchNumber||1,revision:room.revision||0,createdAt:room.createdAt,updatedAt:room.updatedAt,turnProgress:room.turnProgress||{},
    seats:room.seats.map((s,i)=>s?({...s,index:i}):null)};
}
function publicRoomList(){
  return [...rooms.values()].filter(r=>r.isPublic!==false&&!r.gameStarted).map(r=>({
    code:r.code,name:r.name,maxPlayers:r.maxPlayers,difficulty:r.difficulty,duchyId:r.duchyId||1,duchyMode:r.duchyMode||'beginner_same',startCastleMode:r.startCastleMode||'recommended',matchNumber:r.matchNumber||1,
    humans:r.seats.filter(s=>s?.kind==='human').length,ais:r.seats.filter(s=>s?.kind==='ai').length,
    open:r.seats.filter(s=>s===null).length,locked:r.seats.filter(s=>s?.kind==='locked').length,updatedAt:r.updatedAt
  })).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,40);
}
function findSeat(room, clientId){return room.seats.findIndex(s=>s?.kind==='human'&&s.clientId===clientId)}
function gamePlayerForSeat(room, seatIndex){return room.gameState?.players?.find?.(x=>x.roomSeatIndex===seatIndex) ?? room.gameState?.players?.find?.(x=>x.id===seatIndex) ?? null}

function broadcastGameState(room, sourceClientId=null, auditItem=null){
  if(!room.gameState)return;
  room.revision=(room.revision||0)+1;touch(room);
  if(auditItem)audit(room,{...auditItem,revision:room.revision,...summarizeState(room.gameState)});
  broadcast(room,{type:'game_state',state:room.gameState,revision:room.revision,sourceClientId,room:publicRoom(room)});
}
function driveRoomAI(room, reason='ai-drive'){
  if(!room?.gameStarted||!room.gameState||room.gameState.gameOver)return 0;
  const out=driveAI(room.gameState);
  if(out.steps>0){room.gameState=out.state;audit(room,{kind:'server-ai',action:reason,steps:out.steps,...summarizeState(room.gameState)});}
  return out.steps;
}
function temporaryAITakeover(room, seatIndex){
  if(!room.gameStarted||!room.gameState)return;
  const p=gamePlayerForSeat(room,seatIndex);
  if(!p||p.isAI)return;
  p.isAI=true;p.temporaryAI=true;p.ownerClientId=null;p.originalHumanName=p.name;
  p.name=`${p.name} · AI 대행`;
  driveRoomAI(room,'disconnect-takeover');
  broadcastGameState(room,null,{kind:'server',action:'temporary-ai-takeover',seatIndex});
}
function restoreHumanControl(room, seatIndex, clientId, name){
  if(!room.gameStarted||!room.gameState)return;
  const p=gamePlayerForSeat(room,seatIndex);
  if(!p||!p.temporaryAI)return;
  p.isAI=false;p.temporaryAI=false;p.ownerClientId=clientId;p.name=name||p.originalHumanName||p.name.replace(' · AI 대행','');delete p.originalHumanName;
  broadcastGameState(room,null);
}
function ensureHost(room){
  const host=room.seats.find(s=>s?.kind==='human'&&s.clientId===room.hostId&&s.connected);
  if(host)return;const next=room.seats.find(s=>s?.kind==='human'&&s.connected);if(next)room.hostId=next.clientId;
}
function getSession(clientId,name='Player'){
  let s=sessions.get(clientId);
  if(!s){s={clientId,name,roomCode:null,streams:new Set(),disconnectTimer:null};sessions.set(clientId,s)}
  s.name=name||s.name;return s;
}
function sseWrite(res,obj){try{res.write(`data: ${JSON.stringify(obj)}\n\n`)}catch{}}
function sendClient(clientId,obj){const s=sessions.get(clientId);if(!s)return;for(const res of s.streams)sseWrite(res,obj)}
function roomClientIds(room){return [...new Set((room.clients||[]).concat(room.seats.filter(s=>s?.kind==='human').map(s=>s.clientId)))]}
function broadcast(room,obj){for(const id of roomClientIds(room))sendClient(id,obj)}
function emitRoom(room){broadcast(room,{type:'room_state',room:publicRoom(room)})}

function attachClient(room, clientId){room.clients ||= [];if(!room.clients.includes(clientId))room.clients.push(clientId);const s=sessions.get(clientId);if(s)s.roomCode=room.code}
function detachClient(clientId, hard=false){
  const sess=sessions.get(clientId);if(!sess?.roomCode)return;const room=rooms.get(sess.roomCode);if(!room){sess.roomCode=null;return}
  room.clients=(room.clients||[]).filter(id=>id!==clientId);
  const i=findSeat(room,clientId);
  if(i>=0){if(hard&&!room.gameStarted)room.seats[i]=null;else{room.seats[i]={...room.seats[i],connected:false,disconnectedAt:Date.now()};temporaryAITakeover(room,i)}}
  ensureHost(room);touch(room);emitRoom(room);sess.roomCode=null;
}
function permanentAITakeover(room, seatIndex, reason='player-left'){
  const seat=room.seats?.[seatIndex];
  if(!seat)return;
  room.seats[seatIndex]={kind:'ai',name:`AI ${seatIndex+1}`,difficulty:room.difficulty};
  if(room.gameStarted&&room.gameState){
    const p=gamePlayerForSeat(room,seatIndex);
    if(p){p.isAI=true;p.temporaryAI=false;p.ownerClientId=null;p.name=`AI ${seatIndex+1}`;delete p.originalHumanName;}
    driveRoomAI(room,reason);
  }
}
function clearClientFromRoom(room, clientId){
  room.clients=(room.clients||[]).filter(id=>id!==clientId);if(room.turnProgress)delete room.turnProgress[clientId];
  const s=sessions.get(clientId);if(s)s.roomCode=null;
}
function closeRoom(room, reason='방장이 방을 종료했습니다.'){
  const ids=roomClientIds(room);broadcast(room,{type:'room_closed',code:room.code,reason});
  for(const id of ids){const s=sessions.get(id);if(s)s.roomCode=null;}
  rooms.delete(room.code);scheduleSave();
}
function resetForRematch(room){
  room.matchNumber=(room.matchNumber||1)+1;
  room.gameStarted=false;room.gameState=null;room.revision=0;room.turnProgress={};
  room.duchyAssignments=buildDuchyAssignments({mode:room.duchyMode,chosenId:room.duchyId,startCastleMode:room.startCastleMode,playerCount:room.maxPlayers,rngInt:n=>crypto.randomInt(n)});
  room.seats=room.seats.map((seat,i)=>{
    if(!seat)return null;
    if(seat.kind==='human')return {...seat,ready:seat.clientId===room.hostId};
    return {...seat,difficulty:room.difficulty};
  });
  audit(room,{kind:'server',action:'rematch-lobby',matchNumber:room.matchNumber});
  touch(room);emitRoom(room);broadcast(room,{type:'rematch_lobby',room:publicRoom(room)});
}

function joinRoom(room, clientId, name){
  const sess=getSession(clientId,name);attachClient(room,clientId);
  let i=findSeat(room,clientId);
  if(i>=0){room.seats[i]={...room.seats[i],name,connected:true,disconnectedAt:null};restoreHumanControl(room,i,clientId,name)}
  else{
    if(room.gameStarted)throw new Error('이미 시작된 방에는 새 플레이어로 참가할 수 없습니다.');
    i=room.seats.findIndex(s=>s===null);if(i<0)throw new Error('열린 빈 자리가 없습니다. 방장에게 자리를 열어 달라고 요청하세요.');
    room.seats[i]={kind:'human',clientId,name,connected:true,ready:false};
    if(room.startCastleMode==='manual'&&room.duchyAssignments?.[i])room.duchyAssignments[i]={...room.duchyAssignments[i],startCastleIndex:null};
  }
  if(!room.hostId)room.hostId=clientId;touch(room);emitRoom(room);
  sendClient(clientId,{type:'joined_room',code:room.code,seatIndex:i,host:room.hostId===clientId});
  sendClient(clientId,{type:'chat_history',items:room.chat||[]});
  if(room.gameStarted&&room.gameState)sendClient(clientId,{type:'game_state',state:room.gameState,revision:room.revision||0,sourceClientId:null,room:publicRoom(room)});
  return {ok:true,room:publicRoom(room),seatIndex:i};
}

function readBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',d=>{b+=d;if(b.length>2_000_000){reject(new Error('요청이 너무 큽니다.'));req.destroy()}});req.on('end',()=>resolve(parseJSON(b)||{}));req.on('error',reject)})}
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}

async function handleApi(req,res){
  const msg=await readBody(req);const clientId=String(msg.clientId||'').slice(0,120);const name=String(msg.name||'Player').slice(0,32);
  if(!clientId)return json(res,400,{ok:false,error:'clientId가 필요합니다.'});
  const sess=getSession(clientId,name);
  try{
    if(msg.type==='hello')return json(res,200,{ok:true,clientId,version:SERVER_VERSION});
    if(msg.type==='list_rooms')return json(res,200,{ok:true,rooms:publicRoomList()});
    if(msg.type==='create_room'){
      detachClient(clientId,true);const code=makeCode();const requestedPlayers=Math.max(2,Math.min(4,Number(msg.maxPlayers||4)));const maxPlayers=4;const difficulty=['easy','normal','hard'].includes(msg.difficulty)?msg.difficulty:'normal';
      const seats=Array.from({length:4},(_,i)=>i<requestedPlayers?null:{kind:'locked',name:'잠김',colorIndex:i});seats[0]={kind:'human',clientId,name,connected:true,ready:true,colorIndex:0};if(msg.aiFill)for(let i=1;i<requestedPlayers;i++)seats[i]={kind:'ai',name:`AI ${i+1}`,difficulty,colorIndex:i};
      const duchyId=[1,2].includes(Number(msg.duchyId))?Number(msg.duchyId):1;
      const requestedMode=normalizeDuchyMode(msg.duchyMode||'beginner_same');
      if(!ACTIVE_DUCHY_MODES.includes(requestedMode))throw new Error('Classical 영지 배정은 영지 #3~#10 검증 후 활성화됩니다.');
      const duchyMode=requestedMode,startCastleMode=duchyMode==='beginner_same'?'recommended':(['random','manual'].includes(msg.startCastleMode)?msg.startCastleMode:'recommended');
      const duchyAssignments=buildDuchyAssignments({mode:duchyMode,chosenId:duchyId,startCastleMode,playerCount:maxPlayers,rngInt:n=>crypto.randomInt(n)});
      const room={code,name:String(msg.roomName||'버건디 한판').slice(0,40),maxPlayers,difficulty,duchyId,duchyMode,startCastleMode,duchyAssignments,isPublic:msg.isPublic!==false,hostId:clientId,seats,clients:[],gameStarted:false,gameState:null,matchNumber:1,revision:0,createdAt:Date.now(),updatedAt:Date.now(),chat:[],turnProgress:{}};
      rooms.set(code,room);const out=joinRoom(room,clientId,name);scheduleSave();return json(res,200,out);
    }
    if(msg.type==='join_room'){
      detachClient(clientId,true);const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);const room=rooms.get(code);if(!room)throw new Error('방을 찾을 수 없습니다.');return json(res,200,joinRoom(room,clientId,name));
    }
    const room=sess.roomCode?rooms.get(sess.roomCode):null;if(!room)throw new Error('참가 중인 방이 없습니다.');
    if(msg.type==='leave_room'){
      const i=findSeat(room,clientId);
      if(room.gameStarted&&i>=0){permanentAITakeover(room,i,'explicit-leave');clearClientFromRoom(room,clientId);ensureHost(room);touch(room);emitRoom(room);broadcastGameState(room,null,{kind:'server',action:'player-forfeit',seatIndex:i});}
      else detachClient(clientId,true);
      return json(res,200,{ok:true});
    }
    if(msg.type==='set_name'){sess.name=name;const i=findSeat(room,clientId);if(i>=0)room.seats[i]={...room.seats[i],name};touch(room);emitRoom(room);return json(res,200,{ok:true})}
    if(msg.type==='update_room'){
      if(room.hostId!==clientId||room.gameStarted)throw new Error('방장만 게임 시작 전에 방 설정을 바꿀 수 있습니다.');
      if(msg.roomName!==undefined)room.name=String(msg.roomName||'버건디 한판').trim().slice(0,40)||'버건디 한판';
      if(msg.isPublic!==undefined)room.isPublic=!!msg.isPublic;
      if(msg.difficulty!==undefined){const d=['easy','normal','hard'].includes(msg.difficulty)?msg.difficulty:room.difficulty;room.difficulty=d;room.seats=room.seats.map(s=>s?.kind==='ai'?{...s,difficulty:d}:s);}
      touch(room);emitRoom(room);return json(res,200,{ok:true,room:publicRoom(room)});
    }
    if(msg.type==='transfer_host'){
      if(room.hostId!==clientId)throw new Error('방장만 방장을 넘길 수 있습니다.');
      const i=Number(msg.index);if(!Number.isInteger(i)||i<0||i>=room.seats.length)throw new Error('잘못된 자리입니다.');
      const target=room.seats[i];if(target?.kind!=='human'||!target.connected)throw new Error('접속 중인 사람에게만 방장을 넘길 수 있습니다.');
      room.hostId=target.clientId;room.seats[i]={...target,ready:true};audit(room,{kind:'server',action:'host-transfer',from:clientId,to:target.clientId,seatIndex:i});touch(room);emitRoom(room);return json(res,200,{ok:true,hostId:room.hostId});
    }
    if(msg.type==='kick_player'){
      if(room.hostId!==clientId)throw new Error('방장만 플레이어를 내보낼 수 있습니다.');
      const i=Number(msg.index);if(!Number.isInteger(i)||i<0||i>=room.seats.length)throw new Error('잘못된 자리입니다.');
      const target=room.seats[i];if(target?.kind!=='human')throw new Error('사람 플레이어 자리만 내보낼 수 있습니다.');if(target.clientId===room.hostId)throw new Error('방장은 자기 자신을 내보낼 수 없습니다.');
      sendClient(target.clientId,{type:'kicked',code:room.code,reason:'방장에 의해 방에서 나갔습니다.'});clearClientFromRoom(room,target.clientId);
      if(room.gameStarted){permanentAITakeover(room,i,'host-kick');audit(room,{kind:'server',action:'kick-to-ai',seatIndex:i,targetClientId:target.clientId});touch(room);emitRoom(room);broadcastGameState(room,null,{kind:'server',action:'kick-to-ai',seatIndex:i});}
      else {room.seats[i]=null;if(room.startCastleMode==='manual'&&room.duchyAssignments?.[i])room.duchyAssignments[i]={...room.duchyAssignments[i],startCastleIndex:null};audit(room,{kind:'server',action:'kick-player',seatIndex:i,targetClientId:target.clientId});touch(room);emitRoom(room);}
      return json(res,200,{ok:true});
    }
    if(msg.type==='close_room'){
      if(room.hostId!==clientId)throw new Error('방장만 방을 종료할 수 있습니다.');
      closeRoom(room);return json(res,200,{ok:true});
    }
    if(msg.type==='rematch'){
      if(room.hostId!==clientId)throw new Error('방장만 재경기를 시작할 수 있습니다.');
      if(!room.gameStarted||!room.gameState?.gameOver)throw new Error('게임이 끝난 뒤에만 재경기를 만들 수 있습니다.');
      resetForRematch(room);return json(res,200,{ok:true,room:publicRoom(room)});
    }
    if(msg.type==='set_ready'){
      if(room.gameStarted)throw new Error('이미 게임이 시작되었습니다.');const i=findSeat(room,clientId);if(i<0)throw new Error('플레이어 자리를 찾을 수 없습니다.');
      if(!!msg.ready&&room.startCastleMode==='manual'){const a=room.duchyAssignments?.[i];if(!isValidStartCastleIndex(a?.duchyId,a?.startCastleIndex))throw new Error('준비하기 전에 시작 성을 선택하세요.');}
      room.seats[i]={...room.seats[i],ready:room.hostId===clientId?true:!!msg.ready};touch(room);emitRoom(room);return json(res,200,{ok:true});
    }
    if(msg.type==='set_start_castle'){
      if(room.gameStarted)throw new Error('이미 게임이 시작되었습니다.');
      if(room.startCastleMode!=='manual')throw new Error('이 방은 시작 성 직접 선택 모드가 아닙니다.');
      const i=findSeat(room,clientId);if(i<0)throw new Error('플레이어 자리를 찾을 수 없습니다.');
      const a=room.duchyAssignments?.[i];if(!a)throw new Error('영지 배정 정보를 찾을 수 없습니다.');
      const index=Number(msg.index);if(!isValidStartCastleIndex(a.duchyId,index))throw new Error('해당 칸은 시작 성으로 선택할 수 없습니다.');
      room.duchyAssignments[i]={...a,startCastleIndex:index};
      if(room.hostId!==clientId)room.seats[i]={...room.seats[i],ready:false};
      touch(room);emitRoom(room);return json(res,200,{ok:true,index,duchyId:a.duchyId});
    }
    if(msg.type==='set_slot_state'){
      if(room.hostId!==clientId||room.gameStarted)throw new Error('방장만 게임 시작 전에 슬롯을 바꿀 수 있습니다.');
      const i=Number(msg.index);if(!Number.isInteger(i)||i<0||i>=room.seats.length)throw new Error('잘못된 자리입니다.');
      const hostSeat=findSeat(room,room.hostId);if(i===hostSeat)throw new Error('방장 자리는 잠그거나 비울 수 없습니다.');
      const current=room.seats[i];if(current?.kind==='human')throw new Error('사람이 있는 자리는 먼저 강퇴/퇴장 처리하세요.');
      const state=String(msg.state||'open');
      if(state==='open')room.seats[i]=null;
      else if(state==='locked')room.seats[i]={kind:'locked',name:'잠김',colorIndex:i};
      else if(state==='ai')room.seats[i]={kind:'ai',name:`AI ${i+1}`,difficulty:room.difficulty,colorIndex:i};
      else throw new Error('지원하지 않는 슬롯 상태입니다.');
      const a=room.duchyAssignments?.[i];if(state==='ai'&&room.startCastleMode==='manual'&&a&&!isValidStartCastleIndex(a.duchyId,a.startCastleIndex))room.duchyAssignments[i]={...a,startCastleIndex:chooseStartCastleIndex(a.duchyId,'random',n=>crypto.randomInt(n))};
      if(state!=='ai'&&room.startCastleMode==='manual'&&room.duchyAssignments?.[i])room.duchyAssignments[i]={...room.duchyAssignments[i],startCastleIndex:null};
      audit(room,{kind:'server',action:'slot-state',seatIndex:i,state});touch(room);emitRoom(room);return json(res,200,{ok:true,room:publicRoom(room)});
    }
    if(msg.type==='turn_progress'){
      if(!room.gameStarted||!room.gameState)throw new Error('게임이 시작되지 않았습니다.');
      const seatIndex=findSeat(room,clientId);if(seatIndex<0)throw new Error('플레이어 자리를 찾을 수 없습니다.');
      const player=gamePlayerForSeat(room,seatIndex);if(!player||player.ownerClientId!==clientId||player.id!==room.gameState.order?.[room.gameState.active])throw new Error('현재 차례의 플레이어만 진행 상태를 보낼 수 있습니다.');
      room.turnProgress ||= {};room.turnProgress[clientId]={stage:String(msg.stage||'').slice(0,32),label:String(msg.label||'').slice(0,100),actionNumber:Math.max(1,Math.min(2,Number(msg.actionNumber)||1)),updatedAt:Date.now()};
      touch(room);emitRoom(room);return json(res,200,{ok:true});
    }
    if(msg.type==='add_ai'){
      if(room.hostId!==clientId||room.gameStarted)throw new Error('방장만 게임 시작 전에 AI를 추가할 수 있습니다.');const i=room.seats.findIndex(s=>s===null);if(i<0)throw new Error('빈 자리가 없습니다.');room.seats[i]={kind:'ai',name:`AI ${i+1}`,difficulty:room.difficulty,colorIndex:i};
      if(room.startCastleMode==='manual'&&room.duchyAssignments?.[i]&&!isValidStartCastleIndex(room.duchyAssignments[i].duchyId,room.duchyAssignments[i].startCastleIndex))room.duchyAssignments[i]={...room.duchyAssignments[i],startCastleIndex:chooseStartCastleIndex(room.duchyAssignments[i].duchyId,'random',n=>crypto.randomInt(n))};
      touch(room);emitRoom(room);return json(res,200,{ok:true})
    }
    if(msg.type==='remove_seat'){
      if(room.hostId!==clientId||room.gameStarted)throw new Error('방장만 게임 시작 전에 자리를 정리할 수 있습니다.');const i=Number(msg.index);if(!Number.isInteger(i)||i<0||i>=room.seats.length)throw new Error('잘못된 자리입니다.');const seat=room.seats[i];if(seat?.kind==='human'&&seat.clientId===room.hostId)throw new Error('방장 자리는 제거할 수 없습니다.');if(seat?.kind==='human'&&seat.connected)throw new Error('접속 중인 사람은 강제 제거하지 않습니다.');room.seats[i]=null;if(room.startCastleMode==='manual'&&room.duchyAssignments?.[i])room.duchyAssignments[i]={...room.duchyAssignments[i],startCastleIndex:null};touch(room);emitRoom(room);return json(res,200,{ok:true})
    }
    if(msg.type==='start_game'){
      if(room.hostId!==clientId)throw new Error('방장만 시작할 수 있습니다.');if(room.gameStarted)throw new Error('이미 시작되었습니다.');
      const humans=room.seats.filter(s=>s?.kind==='human');
      if(humans.some(s=>!s.connected))throw new Error('연결이 끊긴 사람이 있습니다.');
      if(room.startCastleMode==='manual'){
        for(let i=0;i<room.seats.length;i++){
          const seat=room.seats[i],a=room.duchyAssignments?.[i];
          if(seat?.kind==='human'&&!isValidStartCastleIndex(a?.duchyId,a?.startCastleIndex))throw new Error(`${seat.name||`Player ${i+1}`}의 시작 성을 선택하세요.`);
        }
      }
      if(humans.some(s=>s.clientId!==room.hostId&&!s.ready))throw new Error('아직 준비하지 않은 플레이어가 있습니다.');
      const openSeats=room.seats.filter(s=>s===null).length;if(openSeats)throw new Error('열린 빈 자리가 남아 있습니다. 사람/AI를 넣거나 자리를 잠그세요.');
      const activeSlots=room.seats.map((seat,index)=>({seat,index})).filter(x=>x.seat?.kind==='human'||x.seat?.kind==='ai');if(activeSlots.length<2)throw new Error('최소 2개의 사람/AI 자리가 필요합니다.');
      const gameRoom={...room,maxPlayers:activeSlots.length,seats:activeSlots.map(({seat,index})=>({...seat,roomSeatIndex:index})),duchyAssignments:activeSlots.map(({index})=>room.duchyAssignments?.[index]).filter(Boolean)};
      room.gameStarted=true;room.revision=0;room.turnProgress={};room.gameState=createInitialGame(gameRoom);driveRoomAI(room,'opening-ai');touch(room);emitRoom(room);
      broadcast(room,{type:'game_start',room:publicRoom(room)});broadcastGameState(room,null,{kind:'server',action:'game-created'});return json(res,200,{ok:true,revision:room.revision})
    }
    if(msg.type==='game_command'){
      if(!room.gameStarted||!room.gameState)throw new Error('게임이 시작되지 않았습니다.');
      const base=Number(msg.baseRevision??-1);
      if(base!==(room.revision||0)){
        audit(room,{kind:'reject',clientId,reason:'STALE_COMMAND',base,revision:room.revision||0});
        sendClient(clientId,{type:'stale_state',revision:room.revision||0,state:room.gameState,room:publicRoom(room)});
        return json(res,409,{ok:false,stale:true,revision:room.revision||0});
      }
      try{
        const result=applyGameCommand(room.gameState,clientId,msg.command||{});room.gameState=result.state;if(room.turnProgress)delete room.turnProgress[clientId];
        driveRoomAI(room,'after-human-command');
        broadcastGameState(room,clientId,{kind:'command',clientId,action:result.action});
        return json(res,200,{ok:true,revision:room.revision,action:result.action});
      }catch(e){
        const code=e instanceof GameCommandError?e.code:'COMMAND_ERROR';
        audit(room,{kind:'reject',clientId,reason:code,message:e?.message||String(e),revision:room.revision||0});
        sendClient(clientId,{type:'invalid_command',code,message:e?.message||String(e),revision:room.revision||0,state:room.gameState,room:publicRoom(room)});
        return json(res,422,{ok:false,invalid:true,code,error:e?.message||String(e),revision:room.revision||0});
      }
    }
    if(msg.type==='state_sync'){
      audit(room,{kind:'reject',clientId,reason:'STATE_SYNC_DISABLED',revision:room.revision||0});
      return json(res,410,{ok:false,error:'v8부터 온라인 게임은 전체 상태 업로드를 허용하지 않습니다. game_command를 사용합니다.',code:'STATE_SYNC_DISABLED'});
    }
    if(msg.type==='get_game_state'){
      if(!room.gameStarted||!room.gameState)throw new Error('게임이 시작되지 않았습니다.');
      if(findSeat(room,clientId)<0)throw new Error('이 방의 플레이어가 아닙니다.');
      return json(res,200,{ok:true,state:room.gameState,revision:room.revision||0,room:publicRoom(room)});
    }
    if(msg.type==='game_audit'){
      if(room.hostId!==clientId)throw new Error('방장만 검증 로그를 볼 수 있습니다.');
      return json(res,200,{ok:true,items:(room.audit||[]).slice(-80)});
    }
    if(msg.type==='chat'){
      const text=String(msg.text||'').trim().slice(0,300);if(!text)return json(res,200,{ok:true});const item={id:crypto.randomUUID(),clientId,name:sess.name,text,at:Date.now()};room.chat ||= [];room.chat.push(item);room.chat=room.chat.slice(-100);touch(room);broadcast(room,{type:'chat',item});return json(res,200,{ok:true})
    }
    return json(res,400,{ok:false,error:'알 수 없는 요청입니다.'});
  }catch(e){return json(res,400,{ok:false,error:e?.message||String(e)})}
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(u.pathname==='/health')return json(res,200,{ok:true,version:SERVER_VERSION,validator:'command-authority-v1-room-admin',rooms:rooms.size,sessions:sessions.size,now:new Date().toISOString()});
  if(u.pathname==='/events'){
    const clientId=String(u.searchParams.get('clientId')||'').slice(0,120),name=String(u.searchParams.get('name')||'Player').slice(0,32);if(!clientId){res.writeHead(400);return res.end('clientId required')}
    const sess=getSession(clientId,name);clearTimeout(sess.disconnectTimer);sess.disconnectTimer=null;
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.write(': connected\n\n');sess.streams.add(res);sendClient(clientId,{type:'server_hello',version:SERVER_VERSION,validator:'command-authority-v1-room-admin'});
    if(sess.roomCode){const room=rooms.get(sess.roomCode);if(room){const i=findSeat(room,clientId);if(i>=0)room.seats[i]={...room.seats[i],connected:true,disconnectedAt:null};attachClient(room,clientId);touch(room);emitRoom(room);if(room.gameStarted&&room.gameState)sendClient(clientId,{type:'game_state',state:room.gameState,revision:room.revision||0,sourceClientId:null,room:publicRoom(room)})}}
    const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},25000);
    req.on('close',()=>{clearInterval(keep);sess.streams.delete(res);if(sess.streams.size===0){clearTimeout(sess.disconnectTimer);sess.disconnectTimer=setTimeout(()=>{if(sess.streams.size===0&&sess.roomCode){const room=rooms.get(sess.roomCode);if(room){const i=findSeat(room,clientId);if(i>=0){room.seats[i]={...room.seats[i],connected:false,disconnectedAt:Date.now()};temporaryAITakeover(room,i)}ensureHost(room);touch(room);emitRoom(room)}}},1800)}});return;
  }
  if(u.pathname==='/api'&&req.method==='POST')return handleApi(req,res);
  res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');
});

server.listen(8080);

export class BurgundyHub {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;hubCtx=ctx;
    ctx.blockConcurrencyWhile(async()=>{
      rooms.clear();sessions.clear();
      const stored=await ctx.storage.get('rooms');
      const now=Date.now();
      if(Array.isArray(stored)){
        for(const raw of stored){
          if(!raw?.code||now-(raw.updatedAt||0)>ROOM_TTL_MS)continue;
          const room={...raw,clients:[],seats:Array.isArray(raw.seats)?raw.seats.map(s=>s?.kind==='human'?{...s,connected:false}:s):[]};
          rooms.set(room.code,room);
        }
      }
    });
  }
  async fetch(request){
    hubCtx=this.ctx;
    const url=new URL(request.url);
    if(url.pathname==='/health'||url.pathname==='/api'||url.pathname==='/events'){
      return handleAsNodeRequest(8080,request);
    }
    return new Response('Not found',{status:404});
  }
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'||url.pathname==='/api'||url.pathname==='/events'){
      const id=env.HUB.idFromName('global');
      return env.HUB.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
