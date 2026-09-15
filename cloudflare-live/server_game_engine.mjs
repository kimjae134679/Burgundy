import crypto from 'node:crypto';
import {buildDuchyBoard, axialNeighbors, normalizeDuchyId, VERIFIED_DUCHY_IDS} from './duchy_layouts.mjs';
import {buildDuchyAssignments, finalizeManualStartAssignments, normalizeDuchyMode} from './duchy_assignment.mjs';

const TYPES=['beige','animal','ship','castle','mine','knowledge'];
const BUILDINGS=['창고','망루','목공소','교회','시장','하숙집','은행','시청'];
const ANIMALS=['양','소','돼지','닭'];
const REGION_SCORE={1:1,2:3,3:6,4:10,5:15,6:21,7:28,8:36};
const PHASE_SCORE=[10,8,6,4,2];
const PCOL=['#2477a8','#b43d42','#3c8a5b','#c39d2f'];
const DEPOT_PATTERN=[
  // 2019/base main-board slot order. First N entries are used for N players.
  ['ship','beige','knowledge','animal'],
  ['castle','knowledge','beige','beige'],
  ['animal','beige','ship','knowledge'],
  ['ship','beige','animal','mine'],
  ['mine','knowledge','beige','beige'],
  ['animal','beige','castle','ship']
];

export class GameCommandError extends Error{
  constructor(message,code='ILLEGAL_COMMAND'){super(message);this.name='GameCommandError';this.code=code}
}
const fail=(m,c)=>{throw new GameCommandError(m,c)};
const clone=x=>structuredClone(x);
const rint=n=>crypto.randomInt(n);
const d6=()=>rint(6)+1;
const uid=()=>crypto.randomUUID();
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=rint(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
const mod6=v=>((v-1)%6+6)%6+1;
const hasK=(p,n)=>Array.isArray(p.knowledge)&&p.knowledge.includes(n);
const current=s=>s.players[s.order[s.active]];
function log(s,msg){s.log.unshift(msg);s.log=s.log.slice(0,180)}

function buildBoard(duchyId=1,startCastleIndex=null){return buildDuchyBoard(duchyId,Number.isInteger(startCastleIndex)?{startCastleIndex}:{})}
function neighbors(cells,c){return axialNeighbors(cells,c)}
function buildSupplies(){
  const colored={beige:[],animal:[],ship:[],castle:[],mine:[],knowledge:[]},black=[];
  for(const b of BUILDINGS){for(let i=0;i<5;i++)colored.beige.push({id:uid(),type:'beige',sub:b,black:false});for(let i=0;i<2;i++)black.push({id:uid(),type:'beige',sub:b,black:true})}
  for(const a of ANIMALS){[2,2,3,3,4].forEach(count=>colored.animal.push({id:uid(),type:'animal',sub:a,count,black:false}));[3,4].forEach(count=>black.push({id:uid(),type:'animal',sub:a,count,black:true}))}
  for(let i=0;i<20;i++)colored.ship.push({id:uid(),type:'ship',black:false});for(let i=0;i<6;i++)black.push({id:uid(),type:'ship',black:true});
  for(let i=0;i<14;i++)colored.castle.push({id:uid(),type:'castle',black:false});for(let i=0;i<2;i++)black.push({id:uid(),type:'castle',black:true});
  for(let i=0;i<10;i++)colored.mine.push({id:uid(),type:'mine',black:false});for(let i=0;i<2;i++)black.push({id:uid(),type:'mine',black:true});
  const blackKnowledge=new Set([7,12,14,15,24,25]);
  for(let k=1;k<=26;k++){const t={id:uid(),type:'knowledge',kid:k,black:blackKnowledge.has(k)};if(t.black)black.push(t);else colored.knowledge.push(t)}
  Object.values(colored).forEach(shuffle);shuffle(black);return {colored,black};
}
function newPlayer(i,seat,duchyId=1,startCastleIndex=null){
  const isAI=seat.kind==='ai';const resolvedDuchy=normalizeDuchyId(seat.duchyId||duchyId);const resolvedStart=Number.isInteger(seat.startCastleIndex)?seat.startCastleIndex:startCastleIndex;
  return {id:i,roomSeatIndex:Number.isInteger(seat.roomSeatIndex)?seat.roomSeatIndex:i,name:seat.name||`${isAI?'AI':'Player'} ${i+1}`,isAI,ownerClientId:isAI?null:seat.clientId,color:seat.colorIndex!==undefined?PCOL[seat.colorIndex%PCOL.length]:PCOL[i],score:0,silver:1,workers:0,
    goods:{1:0,2:0,3:0,4:0,5:0,6:0},sold:{1:0,2:0,3:0,4:0,5:0,6:0},storage:[],duchyId:resolvedDuchy,startCastleIndex:resolvedStart,board:buildBoard(resolvedDuchy,resolvedStart),dice:[1,1],used:[false,false],turnPos:1,stackOrder:i,
    bonusActions:0,blackBought:false,knowledge:[],colorBonus:[],completedRegions:[],finished:false};
}
function refillTile(s,type){const pile=s.supplies.colored[type];return pile.length?pile.pop():null}
function setupPhase(s){
  for(const d of s.depots){d.tiles=[];d.goods=d.goods||[]}
  s.black=[];
  for(let di=0;di<6;di++)for(let slot=0;slot<s.n;slot++){
    let type=DEPOT_PATTERN[di][slot];if(s.n===3&&di===5&&slot===2)type=(s.phase===1||s.phase===3)?'mine':'castle';
    const t=refillTile(s,type);if(t)s.depots[di].tiles.push(t);
  }
  for(let i=0;i<s.n*2;i++)if(s.supplies.black.length)s.black.push(s.supplies.black.pop());
  log(s,`페이즈 ${'ABCDE'[s.phase]} 준비: 중앙 타일을 새로 채웠습니다.`);
}
function sortOrder(s){s.order=[...s.players].sort((a,b)=>b.turnPos-a.turnPos||b.stackOrder-a.stackOrder).map(p=>p.id)}
function startRound(s){
  sortOrder(s);s.active=0;s.pendingEffect=null;
  for(const p of s.players){p.dice=[d6(),d6()];p.used=[false,false];p.blackBought=false}
  s.white=d6();const good=s.phaseGoods[s.phase][s.round];if(good)s.depots[s.white-1].goods.push(good);
  log(s,`라운드 ${s.round+1}: 흰 주사위 ${s.white} → 상품 ${good}을 ${s.white}번 창고에 배치.`);
}
function knowledgeFinal(p){
  let score=0,soldTypes=Object.keys(p.sold).filter(k=>p.sold[k]>0).length,soldN=Object.values(p.sold).reduce((a,b)=>a+b,0);
  if(hasK(p,15))score+=soldTypes*2;
  const map={16:'창고',17:'망루',18:'목공소',19:'교회',20:'시장',21:'하숙집',22:'은행',23:'시청'};
  for(let k=16;k<=23;k++)if(hasK(p,k))score+=p.board.filter(c=>c.tile?.type==='beige'&&c.tile.sub===map[k]).length*4;
  if(hasK(p,24))score+=new Set(p.board.filter(c=>c.tile?.type==='animal').map(c=>c.tile.sub)).size*4;
  if(hasK(p,25))score+=soldN;if(hasK(p,26))score+=p.colorBonus.length*3;return score;
}
function endGame(s){
  s.gameOver=true;s.pendingEffect=null;
  for(const p of s.players){const add=Object.values(p.goods).reduce((a,b)=>a+b,0)+p.silver+Math.floor(p.workers/2)+knowledgeFinal(p);p.score+=add;log(s,`${p.name}: 최종 자원/지식 점수 +${add}.`)}
}
function endPhase(s){
  for(const p of s.players){const mines=p.board.filter(c=>c.tile?.type==='mine').length;if(mines){p.silver+=mines;if(hasK(p,2))p.workers+=mines;log(s,`${p.name}: 광산 ${mines}개 → 은화 +${mines}${hasK(p,2)?`, 일꾼 +${mines}`:''}.`)}}
  s.phase++;s.round=0;if(s.phase>=5){endGame(s);return}setupPhase(s);startRound(s);
}
function endTurn(s){
  const p=current(s);if(s.pendingEffect)fail('즉시 효과를 먼저 처리해야 합니다.','PENDING_EFFECT');
  if(p.used.filter(Boolean).length<2||p.bonusActions>0)fail('아직 사용하지 않은 행동이 있습니다.','ACTIONS_REMAIN');
  s.active++;
  if(s.active>=s.order.length){s.round++;if(s.round>=5){endPhase(s);return}startRound(s)}
}

export function createInitialGame(room){
  const seats=room.seats.map((seat,i)=>seat||{kind:'ai',name:`AI ${i}`,difficulty:room.difficulty});
  const n=seats.length,supplies=buildSupplies(),goods=shuffle(Array.from({length:42},(_,i)=>(i%6)+1)),phaseGoods=[];
  for(let p=0;p<5;p++)phaseGoods.push(goods.splice(0,5));
  const duchyMode=normalizeDuchyMode(room.duchyMode||'beginner_same');
  let assignments=Array.isArray(room.duchyAssignments)&&room.duchyAssignments.length===n?structuredClone(room.duchyAssignments):
    buildDuchyAssignments({mode:duchyMode,chosenId:room.duchyId||1,startCastleMode:room.startCastleMode||'recommended',playerCount:n,rngInt:rint});
  if(room.startCastleMode==='manual')assignments=finalizeManualStartAssignments(assignments,seats,rint);
  seats.forEach((seat,i)=>{seat.duchyId=assignments[i].duchyId;seat.startCastleIndex=assignments[i].startCastleIndex});
  const players=seats.map((seat,i)=>newPlayer(i,seat,assignments[i].duchyId,assignments[i].startCastleIndex));const start=rint(n),order=[];for(let k=0;k<n;k++)order.push((start+k)%n);
  order.forEach((id,k)=>{players[id].workers=k+1;players[id].stackOrder=n-k});
  for(const p of players)for(let k=0;k<3;k++){const g=goods.shift();if(g)p.goods[g]++}
  const allSame=players.every(p=>p.duchyId===players[0].duchyId);
  const s={n,humans:seats.filter(x=>x.kind==='human').length,diff:room.difficulty,players,order,active:0,phase:0,round:0,phaseGoods,supplies,
    depots:Array.from({length:6},()=>({tiles:[],goods:[]})),black:[],log:[],bonusTaken:Object.fromEntries(TYPES.map(t=>[t,0])),white:1,gameOver:false,roomCode:room.code,pendingEffect:null,duchyId:allSame?players[0].duchyId:null,duchyMode,duchyAssignments:assignments,verifiedDuchies:[...VERIFIED_DUCHY_IDS],engineVersion:'11.0'};
  setupPhase(s);startRound(s);return s;
}

function dieRefValue(p,cmd){
  if(cmd.die==='bonus'){if(p.bonusActions<=0)fail('성 추가 행동이 없습니다.','NO_BONUS_ACTION');const v=Number(cmd.value);if(!Number.isInteger(v)||v<1||v>6)fail('추가 행동 주사위 값이 잘못되었습니다.','BAD_DIE');return v}
  const i=Number(cmd.die);if(!Number.isInteger(i)||i<0||i>1)fail('주사위 선택이 잘못되었습니다.','BAD_DIE');if(p.used[i])fail('이미 사용한 주사위입니다.','DIE_USED');return p.dice[i]
}
function consumeDie(p,cmd){if(cmd.die==='bonus')p.bonusActions--;else p.used[Number(cmd.die)]=true}
function freeShiftForTake(p){return hasK(p,12)}
function freeShiftForPlace(p,type){return (type==='beige'&&hasK(p,9))||((type==='ship'||type==='animal')&&hasK(p,10))||((type==='castle'||type==='mine'||type==='knowledge')&&hasK(p,11))}
function matches(v,target,free){return v===target||(free&&(mod6(v-1)===target||mod6(v+1)===target))}
function tileName(t){if(t.type==='beige')return t.sub;if(t.type==='animal')return `${t.sub} ${t.count}`;if(t.type==='knowledge')return `지식 #${t.kid}`;return ({ship:'선박',castle:'성',mine:'광산'}[t.type]||t.type)}
function discardIfNeeded(p,index){
  if(p.storage.length<3)return;
  if(!Number.isInteger(index)||index<0||index>=p.storage.length)fail('보관소가 가득 찼습니다. 버릴 타일을 선택하세요.','STORAGE_FULL');
  const old=p.storage.splice(index,1)[0];
  return old;
}
function purchaseMethods(p){const m=[];if(p.silver>=2)m.push('s2');if(hasK(p,6)&&p.silver>=1&&p.workers>=1)m.push('s1w1');if(hasK(p,6)&&p.workers>=2)m.push('w2');return m}
function payPurchase(p,method){
  if(method==='s2'&&p.silver>=2){p.silver-=2;return '은화 2'}
  if(method==='s1w1'&&hasK(p,6)&&p.silver>=1&&p.workers>=1){p.silver--;p.workers--;return '은화 1 + 일꾼 1'}
  if(method==='w2'&&hasK(p,6)&&p.workers>=2){p.workers-=2;return '일꾼 2'}
  fail('선택한 구매 비용을 지불할 수 없습니다.','PURCHASE_PAYMENT')
}
function canPlace(s,p,t,c,v,ignoreNumber=false){
  if(!t||!c||c.tile||c.type!==t.type)return false;
  if(!ignoreNumber&&!matches(v,c.num,freeShiftForPlace(p,t.type)))return false;
  if(!neighbors(p.board,c).some(n=>n.tile))return false;
  if(t.type==='beige'&&!hasK(p,1)&&p.board.some(x=>x.region===c.region&&x.tile?.type==='beige'&&x.tile.sub===t.sub))return false;
  return true;
}
function sellGoods(s,p,v){const n=p.goods[v]||0;if(!n)fail(`${v}번 상품이 없습니다.`,'NO_GOODS');p.goods[v]=0;p.sold[v]+=n;const silver=hasK(p,3)?2:1;p.silver+=silver;if(hasK(p,4))p.workers++;const vp=n*s.n;p.score+=vp;log(s,`${p.name}: ${v}번 상품 ${n}개 판매 → +${vp}점, 은화 +${silver}.`)}
function checkRegion(s,p,c){if(p.completedRegions.includes(c.region))return;const cells=p.board.filter(x=>x.region===c.region);if(cells.every(x=>x.tile)){p.completedRegions.push(c.region);const pts=(REGION_SCORE[cells.length]||36)+PHASE_SCORE[s.phase];p.score+=pts;log(s,`${p.name}: 영역 ${cells.length}칸 완성 → +${pts}점.`)}}
function checkColor(s,p,type){if(p.colorBonus.includes(type))return;const cells=p.board.filter(x=>x.type===type);if(!cells.length||!cells.every(x=>x.tile))return;p.colorBonus.push(type);const rank=++s.bonusTaken[type];const pts=rank===1?s.n+3:rank===2?s.n:0;p.score+=pts;log(s,`${p.name}: ${type} 전체 완성 ${rank}번째 → +${pts}점.`)}
function collectibleCount(p,arr){const types=new Set(Object.keys(p.goods).filter(k=>p.goods[k]>0).map(Number));let free=3-types.size,n=0;const nt=new Set();for(const g of arr){if(types.has(g)||nt.has(g)){n++;continue}if(free>0){nt.add(g);free--;n++}}return n}
function collectGoods(s,p,di){
  if(di<0||di>5)fail('상품 창고 번호가 잘못되었습니다.','BAD_DEPOT');const arr=s.depots[di].goods,existing=new Set(Object.keys(p.goods).filter(k=>p.goods[k]>0).map(Number)),chosen=new Set(),keep=[];let free=3-existing.size;
  for(const g of arr){if(existing.has(g)||chosen.has(g)){p.goods[g]++;continue}if(free>0){chosen.add(g);free--;p.goods[g]++}else keep.push(g)}
  const took=arr.length-keep.length;s.depots[di].goods=keep;log(s,`${p.name}: ${di+1}번 상품 창고에서 ${took}개 수령.`);return took;
}
function setPending(s,p,effect){s.pendingEffect={playerId:p.id,...effect}}
function buildingEffect(s,p,b){
  if(b==='하숙집'){p.workers+=4;log(s,`${p.name}: 하숙집 → 일꾼 +4.`);return}
  if(b==='은행'){p.silver+=2;log(s,`${p.name}: 은행 → 은화 +2.`);return}
  if(b==='망루'){p.score+=4;log(s,`${p.name}: 망루 → +4점.`);return}
  if(b==='창고'){if(Object.values(p.goods).some(n=>n>0))setPending(s,p,{type:'warehouse'});return}
  if(b==='시청'){if(p.storage.length)setPending(s,p,{type:'townhall'});return}
  let allowed=null;if(b==='시장')allowed=['ship','animal'];if(b==='목공소')allowed=['beige'];if(b==='교회')allowed=['mine','knowledge','castle'];
  if(allowed){const any=s.depots.some(d=>d.tiles.some(t=>allowed.includes(t.type)));if(any)setPending(s,p,{type:'buildingTake',building:b,allowed})}
}
function resolvePlaced(s,p,c,t){
  if(t.type==='animal'){const herd=p.board.filter(x=>x.region===c.region&&x.tile?.type==='animal'&&x.tile.sub===t.sub);let pts=herd.reduce((sum,x)=>sum+(x.tile.count||0),0);if(hasK(p,7))pts+=herd.length;p.score+=pts;log(s,`${p.name}: ${t.sub} 점수 +${pts}.`)}
  else if(t.type==='ship'){p.turnPos++;p.stackOrder=Date.now()+rint(1000);if(s.depots.some(d=>d.goods.length))setPending(s,p,{type:'ship'})}
  else if(t.type==='castle'){p.bonusActions++;log(s,`${p.name}: 성 → 추가 행동 1회.`)}
  else if(t.type==='knowledge'){if(!p.knowledge.includes(t.kid))p.knowledge.push(t.kid);log(s,`${p.name}: 지식 #${t.kid} 활성화.`)}
  else if(t.type==='beige')buildingEffect(s,p,t.sub);
  checkRegion(s,p,c);checkColor(s,p,t.type);
}
function resolvePending(s,p,cmd){
  const pe=s.pendingEffect;if(!pe||pe.playerId!==p.id)fail('처리할 즉시 효과가 없습니다.','NO_PENDING_EFFECT');
  const skip=!!cmd.skip;
  if(pe.type==='ship'){
    if(skip){s.pendingEffect=null;return}
    const di=Number(cmd.depotIndex);if(!Number.isInteger(di)||di<0||di>5||!s.depots[di].goods.length)fail('선박 상품 창고 선택이 잘못되었습니다.','BAD_DEPOT');collectGoods(s,p,di);
    if(hasK(p,5)){const adjacent=[(di+5)%6,(di+1)%6].filter(x=>s.depots[x].goods.length);if(adjacent.length){setPending(s,p,{type:'shipAdjacent',baseDepot:di,allowedDepots:adjacent});return}}
    s.pendingEffect=null;return;
  }
  if(pe.type==='shipAdjacent'){
    if(!skip){const di=Number(cmd.depotIndex);if(!pe.allowedDepots.includes(di))fail('인접 상품 창고가 아닙니다.','BAD_DEPOT');collectGoods(s,p,di)}s.pendingEffect=null;return;
  }
  if(pe.type==='warehouse'){
    if(!skip){const g=Number(cmd.goodType);if(g<1||g>6||!p.goods[g])fail('판매할 상품이 없습니다.','NO_GOODS');sellGoods(s,p,g)}s.pendingEffect=null;return;
  }
  if(pe.type==='townhall'){
    if(skip){s.pendingEffect=null;return}
    const si=Number(cmd.storageIndex),ci=Number(cmd.cellIndex);const t=p.storage[si],c=p.board[ci];if(!t||!c||!canPlace(s,p,t,c,1,true))fail('시청 효과로 그 타일을 배치할 수 없습니다.','ILLEGAL_PLACEMENT');p.storage.splice(si,1);c.tile=t;s.pendingEffect=null;log(s,`${p.name}: 시청으로 ${tileName(t)} 즉시 배치.`);resolvePlaced(s,p,c,t);return;
  }
  if(pe.type==='buildingTake'){
    if(skip){s.pendingEffect=null;return}
    const di=Number(cmd.depotIndex),tileId=String(cmd.tileId||'');if(di<0||di>5)fail('창고 번호가 잘못되었습니다.','BAD_DEPOT');const ix=s.depots[di].tiles.findIndex(t=>t.id===tileId),t=s.depots[di].tiles[ix];if(!t||!pe.allowed.includes(t.type))fail('이 건물 효과로 가져올 수 없는 타일입니다.','ILLEGAL_BUILDING_TAKE');
    const old=discardIfNeeded(p,Number(cmd.discardStorageIndex));if(old)log(s,`${p.name}: 보관 공간 확보를 위해 ${tileName(old)} 버림.`);s.depots[di].tiles.splice(ix,1);p.storage.push(t);s.pendingEffect=null;log(s,`${p.name}: ${pe.building} 효과 → ${tileName(t)} 획득.`);return;
  }
  fail('알 수 없는 즉시 효과입니다.','BAD_PENDING_EFFECT');
}

function assertActor(s,clientId){
  if(s.gameOver)fail('게임이 종료되었습니다.','GAME_OVER');const p=current(s);if(p.isAI)fail('현재는 AI 턴입니다.','AI_TURN');if(p.ownerClientId!==clientId)fail('현재 플레이어의 차례가 아닙니다.','NOT_YOUR_TURN');return p;
}
export function applyGameCommand(state,clientId,command){
  const s=clone(state),cmd=command||{},kind=String(cmd.kind||'');
  if(kind==='cheat_extra_die'||kind==='cheat_endgame'){
    const humans=s.players.filter(x=>!x.isAI);
    if(humans.length!==1||humans[0].ownerClientId!==clientId)fail('치트 명령은 사람 플레이어가 1명인 게임에서만 사용할 수 있습니다.','CHEAT_NOT_ALLOWED');
    const human=humans[0];
    if(kind==='cheat_extra_die'){const value=Number(cmd.value);if(s.gameOver)fail('게임이 종료되었습니다.','GAME_OVER');if(!Number.isInteger(value)||value<1||value>6)fail('추가 주사위는 1~6만 가능합니다.','BAD_DIE');human.bonusActions=(human.bonusActions||0)+1;log(s,`${human.name}: 치트 추가 주사위 ${value} · 추가 행동 +1.`);return {state:s,action:kind};}
    if(!s.gameOver){endGame(s);log(s,`${human.name}: 치트로 최종 점수 계산을 시작했습니다.`)}return {state:s,action:kind};
  }
  const p=assertActor(s,clientId);
  if(s.pendingEffect&&kind!=='resolve_pending')fail('즉시 효과를 먼저 처리해야 합니다.','PENDING_EFFECT');
  if(kind==='adjust_die'){
    const i=Number(cmd.dieIndex),delta=Number(cmd.delta);if(!Number.isInteger(i)||i<0||i>1||p.used[i])fail('보정할 주사위가 잘못되었습니다.','BAD_DIE');if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>(hasK(p,8)?2:1))fail('보정 범위를 벗어났습니다.','BAD_ADJUST');if(p.workers<1)fail('일꾼이 없습니다.','NO_WORKER');p.dice[i]=mod6(p.dice[i]+delta);p.workers--;log(s,`${p.name}: 일꾼 1개 사용 (${delta>0?'+':''}${delta}) → 주사위 ${p.dice[i]}.`);
  }else if(kind==='take_tile'){
    const v=dieRefValue(p,cmd),di=Number(cmd.depotIndex),tileId=String(cmd.tileId||'');if(di<0||di>5||!matches(v,di+1,freeShiftForTake(p)))fail('선택한 주사위로 이 창고에서 타일을 가져올 수 없습니다.','DIE_MISMATCH');const ix=s.depots[di].tiles.findIndex(t=>t.id===tileId),t=s.depots[di].tiles[ix];if(!t)fail('타일을 찾을 수 없습니다.','TILE_NOT_FOUND');const old=discardIfNeeded(p,Number(cmd.discardStorageIndex));if(old)log(s,`${p.name}: 보관 공간 확보를 위해 ${tileName(old)} 버림.`);s.depots[di].tiles.splice(ix,1);p.storage.push(t);consumeDie(p,cmd);log(s,`${p.name}: ${di+1}번 창고에서 ${tileName(t)} 획득.`);
  }else if(kind==='place_tile'){
    const v=dieRefValue(p,cmd),tileId=String(cmd.tileId||''),si=p.storage.findIndex(t=>t.id===tileId),ci=Number(cmd.cellIndex),t=p.storage[si],c=p.board[ci];if(!t||!c)fail('배치할 타일/칸을 찾을 수 없습니다.','TILE_NOT_FOUND');if(!canPlace(s,p,t,c,v,false))fail('그 칸에는 이 타일을 배치할 수 없습니다.','ILLEGAL_PLACEMENT');p.storage.splice(si,1);c.tile=t;consumeDie(p,cmd);log(s,`${p.name}: ${tileName(t)} 배치.`);resolvePlaced(s,p,c,t);
  }else if(kind==='sell_goods'){
    const v=dieRefValue(p,cmd);sellGoods(s,p,v);consumeDie(p,cmd);
  }else if(kind==='take_workers'){
    dieRefValue(p,cmd);const n=hasK(p,14)?4:2;p.workers+=n;if(hasK(p,13))p.silver++;consumeDie(p,cmd);log(s,`${p.name}: 일꾼 +${n}${hasK(p,13)?', 은화 +1':''}.`);
  }else if(kind==='purchase'){
    if(p.blackBought)fail('이번 턴에는 이미 구매했습니다.','ALREADY_BOUGHT');const method=String(cmd.payment||''),methods=purchaseMethods(p);if(!methods.includes(method))fail('구매 비용 지불 방식이 잘못되었습니다.','PURCHASE_PAYMENT');let t=null,remove=null,sourceLabel='검은 시장';
    if(cmd.source==='black'){const id=String(cmd.tileId||'');const ix=s.black.findIndex(x=>x.id===id);if(ix<0)fail('검은 시장 타일을 찾을 수 없습니다.','TILE_NOT_FOUND');t=s.black[ix];remove=()=>s.black.splice(ix,1)}
    else{if(!hasK(p,6))fail('번호 창고 구매에는 지식 #6이 필요합니다.','NO_KNOWLEDGE_6');const di=Number(cmd.source),id=String(cmd.tileId||''),ix=s.depots[di]?.tiles.findIndex(x=>x.id===id);if(!Number.isInteger(di)||di<0||di>5||ix<0)fail('구매할 타일을 찾을 수 없습니다.','TILE_NOT_FOUND');t=s.depots[di].tiles[ix];remove=()=>s.depots[di].tiles.splice(ix,1);sourceLabel=`${di+1}번 창고`}
    const old=discardIfNeeded(p,Number(cmd.discardStorageIndex));if(old)log(s,`${p.name}: 보관 공간 확보를 위해 ${tileName(old)} 버림.`);const paid=payPurchase(p,method);remove();p.storage.push(t);p.blackBought=true;log(s,`${p.name}: ${paid}로 ${sourceLabel}의 ${tileName(t)} 구매.`);
  }else if(kind==='resolve_pending'){
    resolvePending(s,p,cmd);
  }else if(kind==='end_turn'){
    endTurn(s);
  }else fail('알 수 없는 게임 명령입니다.','UNKNOWN_COMMAND');
  return {state:s,action:kind};
}

function tileBaseValue(t){return ({castle:10,beige:8,animal:7,ship:7,knowledge:6,mine:5}[t.type]||4)+(t.type==='animal'?(t.count||0):0)}
function canPlaceAI(s,p,t,c,v,ignore=false){return canPlace(s,p,t,c,v,ignore)}
function aiResolvePending(s,p){
  const pe=s.pendingEffect;if(!pe)return;
  if(pe.type==='ship'){let best=-1,bv=-1;for(let i=0;i<6;i++){const n=collectibleCount(p,s.depots[i].goods);if(n>bv){bv=n;best=i}}if(best>=0&&s.depots[best].goods.length)resolvePending(s,p,{depotIndex:best});else resolvePending(s,p,{skip:true});return aiResolvePending(s,p)}
  if(pe.type==='shipAdjacent'){let best=pe.allowedDepots.sort((a,b)=>collectibleCount(p,s.depots[b].goods)-collectibleCount(p,s.depots[a].goods))[0];resolvePending(s,p,best===undefined?{skip:true}:{depotIndex:best});return}
  if(pe.type==='warehouse'){const ks=Object.keys(p.goods).filter(k=>p.goods[k]>0).sort((a,b)=>p.goods[b]-p.goods[a]);resolvePending(s,p,ks.length?{goodType:+ks[0]}:{skip:true});return}
  if(pe.type==='townhall'){let best=null;for(let si=0;si<p.storage.length;si++)for(const c of p.board){const t=p.storage[si];if(canPlaceAI(s,p,t,c,1,true)){const v=tileBaseValue(t);if(!best||v>best.v)best={si,ci:c.idx,v}}}resolvePending(s,p,best?{storageIndex:best.si,cellIndex:best.ci}:{skip:true});return aiResolvePending(s,p)}
  if(pe.type==='buildingTake'){let opts=[];for(let di=0;di<6;di++)for(const t of s.depots[di].tiles)if(pe.allowed.includes(t.type))opts.push({di,t,v:tileBaseValue(t)});opts.sort((a,b)=>b.v-a.v);if(!opts.length){resolvePending(s,p,{skip:true});return}const o=opts[0],cmd={depotIndex:o.di,tileId:o.t.id};if(p.storage.length>=3){let wi=0;for(let i=1;i<p.storage.length;i++)if(tileBaseValue(p.storage[i])<tileBaseValue(p.storage[wi]))wi=i;cmd.discardStorageIndex=wi}resolvePending(s,p,cmd);return}
}
function aiBestAction(s,p,die){
  let best={kind:'take_workers',score:2,die};
  if(p.goods[die]>0)best={kind:'sell_goods',score:4+p.goods[die]*s.n,die};
  for(let si=0;si<p.storage.length;si++)for(const c of p.board){const t=p.storage[si];if(canPlaceAI(s,p,t,c,die,false)){let score=tileBaseValue(t)+4;const reg=p.board.filter(x=>x.region===c.region);if(reg.filter(x=>x.tile).length===reg.length-1)score+=10+REGION_SCORE[reg.length];if(score>best.score)best={kind:'place_tile',score,die,tileId:t.id,cellIndex:c.idx}}}
  if(p.storage.length<3){const di=die-1;for(const t of s.depots[di].tiles){const score=tileBaseValue(t);if(score>best.score)best={kind:'take_tile',score,die,depotIndex:di,tileId:t.id}}}
  return best;
}
function applyAIAction(s,p,a,dieIndex){
  if(a.kind==='take_workers'){const n=hasK(p,14)?4:2;p.workers+=n;if(hasK(p,13))p.silver++;p.used[dieIndex]=true;log(s,`${p.name}: 일꾼 +${n}.`);return}
  if(a.kind==='sell_goods'){sellGoods(s,p,a.die);p.used[dieIndex]=true;return}
  if(a.kind==='take_tile'){const ix=s.depots[a.depotIndex].tiles.findIndex(t=>t.id===a.tileId);if(ix>=0){const t=s.depots[a.depotIndex].tiles.splice(ix,1)[0];p.storage.push(t);p.used[dieIndex]=true;log(s,`${p.name}: ${a.depotIndex+1}번 창고에서 ${tileName(t)} 획득.`);return}}
  if(a.kind==='place_tile'){const si=p.storage.findIndex(t=>t.id===a.tileId),c=p.board[a.cellIndex];if(si>=0&&c){const t=p.storage.splice(si,1)[0];c.tile=t;p.used[dieIndex]=true;log(s,`${p.name}: ${tileName(t)} 배치.`);resolvePlaced(s,p,c,t);return}}
  p.workers+=2;p.used[dieIndex]=true;
}
function maybeAIPurchase(s,p){
  if(p.blackBought||p.storage.length>=3||!purchaseMethods(p).length)return;
  const cands=s.black.map(t=>({source:'black',t,v:tileBaseValue(t)}));if(hasK(p,6))for(let di=0;di<6;di++)s.depots[di].tiles.forEach(t=>cands.push({source:di,t,v:tileBaseValue(t)}));if(!cands.length)return;cands.sort((a,b)=>b.v-a.v);if(cands[0].v<6)return;
  const c=cands[0],method=purchaseMethods(p)[0];payPurchase(p,method);if(c.source==='black')s.black.splice(s.black.findIndex(t=>t.id===c.t.id),1);else s.depots[c.source].tiles.splice(s.depots[c.source].tiles.findIndex(t=>t.id===c.t.id),1);p.storage.push(c.t);p.blackBought=true;log(s,`${p.name}: ${tileName(c.t)} 구매.`)
}
function runOneAI(s){
  const p=current(s);if(!p?.isAI||s.gameOver)return false;
  while(s.pendingEffect)aiResolvePending(s,p);
  maybeAIPurchase(s,p);
  for(let i=0;i<2;i++)if(!p.used[i]){const a=aiBestAction(s,p,p.dice[i]);applyAIAction(s,p,a,i);while(s.pendingEffect)aiResolvePending(s,p)}
  while(p.bonusActions>0){p.bonusActions--;p.workers+=hasK(p,14)?4:2;log(s,`${p.name}: 성 추가 행동으로 일꾼 획득.`)}
  while(s.pendingEffect)aiResolvePending(s,p);
  endTurn(s);return true;
}
export function driveAI(state,maxTurns=12){
  const s=clone(state);let steps=0;while(!s.gameOver&&current(s)?.isAI&&steps<maxTurns){runOneAI(s);steps++}return {state:s,steps};
}

export function summarizeState(s){return {phase:s.phase,round:s.round,active:s.active,currentPlayerId:s.gameOver?null:s.order[s.active],pendingEffect:s.pendingEffect?.type||null,gameOver:s.gameOver}}
