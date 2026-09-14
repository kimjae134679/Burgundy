import {VERIFIED_DUCHY_IDS, normalizeDuchyId, castleCandidateIndices, recommendedStartCastleIndex} from './duchy_layouts.mjs';

export const DUCHY_MODES=['beginner_same','identical_random','random_per_player','random_no8','classical'];
export const ACTIVE_DUCHY_MODES=['beginner_same','identical_random','random_per_player','random_no8'];

export function normalizeDuchyMode(value){
  return DUCHY_MODES.includes(value)?value:'beginner_same';
}

function pick(list,rngInt){
  if(!list.length)throw new Error('선택 가능한 영지가 없습니다.');
  const i=Math.max(0,Math.min(list.length-1,Number(rngInt(list.length))||0));
  return list[i];
}

export function canUseClassical(playerCount=2){
  return VERIFIED_DUCHY_IDS.length >= Math.max(2,Number(playerCount)||2)*2;
}

export function assignDuchyIds({mode='beginner_same',chosenId=1,playerCount=2,rngInt=n=>Math.floor(Math.random()*n)}={}){
  mode=normalizeDuchyMode(mode);
  const n=Math.max(2,Math.min(4,Number(playerCount)||2));
  const verified=[...VERIFIED_DUCHY_IDS];
  if(mode==='beginner_same')return Array(n).fill(normalizeDuchyId(chosenId));
  if(mode==='identical_random')return Array(n).fill(pick(verified,rngInt));
  if(mode==='random_no8'){
    const pool=verified.filter(id=>id!==8);
    return Array.from({length:n},()=>pick(pool,rngInt));
  }
  if(mode==='random_per_player')return Array.from({length:n},()=>pick(verified,rngInt));
  if(mode==='classical'){
    if(!canUseClassical(n))throw new Error('Classical 영지 배정은 검증된 영지 #3~#10 추가 후 활성화됩니다.');
    const pool=[...verified];
    const out=[];
    for(let i=0;i<n;i++){
      const a=pool.splice(rngInt(pool.length),1)[0];
      const b=pool.splice(rngInt(pool.length),1)[0];
      out.push(pick([a,b],rngInt));
    }
    return out;
  }
  return Array(n).fill(normalizeDuchyId(chosenId));
}

export function chooseStartCastleIndex(duchyId,mode='recommended',rngInt=n=>Math.floor(Math.random()*n)){
  const candidates=castleCandidateIndices(duchyId);
  if(!candidates.length)throw new Error(`영지 #${duchyId}에 성 칸이 없습니다.`);
  if(mode==='manual')return null;
  if(mode==='random')return pick(candidates,rngInt);
  return recommendedStartCastleIndex(duchyId);
}

export function isValidStartCastleIndex(duchyId,index){
  return Number.isInteger(index)&&castleCandidateIndices(duchyId).includes(index);
}

export function finalizeManualStartAssignments(assignments,seats,rngInt=n=>Math.floor(Math.random()*n)){
  return assignments.map((a,i)=>{
    if(isValidStartCastleIndex(a.duchyId,a.startCastleIndex))return {...a};
    const seat=seats?.[i];
    if(seat?.kind==='human')throw new Error(`${seat.name||`Player ${i+1}`}의 시작 성을 선택하세요.`);
    return {...a,startCastleIndex:chooseStartCastleIndex(a.duchyId,'random',rngInt)};
  });
}

export function buildDuchyAssignments({mode='beginner_same',chosenId=1,startCastleMode='recommended',playerCount=2,rngInt=n=>Math.floor(Math.random()*n)}={}){
  const duchyIds=assignDuchyIds({mode,chosenId,playerCount,rngInt});
  const effectiveStartMode=normalizeDuchyMode(mode)==='beginner_same'?'recommended':(startCastleMode==='manual'?'manual':startCastleMode==='random'?'random':'recommended');
  return duchyIds.map(duchyId=>({duchyId,startCastleIndex:chooseStartCastleIndex(duchyId,effectiveStartMode,rngInt)}));
}
