// 2019 base-game duchy data used by the server engine.
// #1 was re-verified in v11 against a clear physical-board reference image plus two independent implementations.
// #2 is the new 2019 beginner duchy and was transcribed from the 2019 player-board reference image.
// Official artwork is not included; only gameplay data is represented.

export const VERIFIED_DUCHY_IDS = [1, 2];

export const DUCHY_LAYOUTS = {
  1: [
    [['animal',6],['castle',5],['castle',4],['knowledge',3]],
    [['animal',2],['animal',1],['castle',6],['knowledge',5],['beige',4]],
    [['animal',5],['animal',4],['beige',3],['knowledge',1],['beige',2],['beige',3]],
    [['ship',6],['ship',1],['ship',2],['castle',6,'start'],['ship',5],['ship',4],['ship',3]],
    [['beige',2],['beige',5],['mine',4],['beige',3],['beige',1],['animal',2]],
    [['beige',6],['mine',1],['knowledge',2],['beige',5],['beige',6]],
    [['mine',3],['knowledge',4],['knowledge',1],['beige',3]]
  ],
  2: [
    [['knowledge',6],['knowledge',5],['knowledge',6],['animal',3]],
    [['beige',2],['beige',1],['ship',6],['animal',5],['mine',4]],
    [['beige',5],['beige',4],['beige',3],['ship',1],['animal',2],['ship',3]],
    [['animal',6],['beige',1],['ship',2],['castle',6,'start'],['knowledge',5],['beige',4],['ship',1]],
    [['knowledge',2],['ship',5],['beige',4],['animal',3],['knowledge',1],['beige',2]],
    [['beige',6],['beige',1],['animal',1],['beige',5],['mine',6]],
    [['animal',3],['animal',4],['beige',1],['animal',3]]
  ]
};

export function normalizeDuchyId(value, fallback=1){
  const n=Number(value);
  return VERIFIED_DUCHY_IDS.includes(n) ? n : fallback;
}

export function axialFor(row, col){
  const r=row-3;
  const qMin=Math.max(-3,-r-3);
  return {q:qMin+col,r};
}

export function axialNeighbors(cells, cell){
  const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  return dirs.map(([dq,dr])=>cells.find(c=>c.q===cell.q+dq&&c.r===cell.r+dr)).filter(Boolean);
}

export function castleCandidateIndices(id=1){
  const duchyId=normalizeDuchyId(id);
  let idx=0;const out=[];
  for(const row of DUCHY_LAYOUTS[duchyId])for(const a of row){if(a[0]==='castle')out.push(idx);idx++}
  return out;
}

export function recommendedStartCastleIndex(id=1){
  const duchyId=normalizeDuchyId(id);let idx=0;
  for(const row of DUCHY_LAYOUTS[duchyId])for(const a of row){if(a[2]==='start')return idx;idx++}
  const candidates=castleCandidateIndices(duchyId);return candidates[0]??-1;
}

export function buildDuchyBoard(id=1,options={}){
  const duchyId=normalizeDuchyId(id);
  const rows=DUCHY_LAYOUTS[duchyId];
  const startCastleIndex=Number.isInteger(options?.startCastleIndex)?options.startCastleIndex:recommendedStartCastleIndex(duchyId);
  if(!castleCandidateIndices(duchyId).includes(startCastleIndex))throw new Error(`Duchy ${duchyId}: invalid starting castle index ${startCastleIndex}`);
  const cells=[];let idx=0;
  rows.forEach((row,rowIndex)=>row.forEach((a,col)=>{
    const pos=axialFor(rowIndex,col);const thisIndex=idx++;
    cells.push({idx:thisIndex,row:rowIndex,col,q:pos.q,r:pos.r,type:a[0],num:a[1],start:thisIndex===startCastleIndex,tile:null,region:-1});
  }));
  let region=0;
  for(const c of cells){
    if(c.region>=0)continue;
    c.region=region;
    const stack=[c];
    while(stack.length){
      const x=stack.pop();
      for(const n of axialNeighbors(cells,x)){
        if(n.region<0&&n.type===c.type){n.region=region;stack.push(n)}
      }
    }
    region++;
  }
  const start=cells.find(c=>c.start);
  if(!start)throw new Error(`Duchy ${duchyId} has no starting castle`);
  start.tile={id:'start',type:'castle',sub:'시작 성',black:false};
  return cells;
}

export function validateDuchyLayout(id){
  const duchyId=normalizeDuchyId(id, NaN);
  if(!duchyId)throw new Error(`Unknown duchy: ${id}`);
  const rows=DUCHY_LAYOUTS[duchyId];
  const expected=[4,5,6,7,6,5,4];
  if(rows.length!==7||rows.some((row,i)=>row.length!==expected[i]))throw new Error(`Duchy ${duchyId}: bad 37-hex geometry`);
  const flat=rows.flat();
  if(flat.length!==37)throw new Error(`Duchy ${duchyId}: expected 37 cells`);
  const valid=new Set(['beige','animal','ship','castle','mine','knowledge']);
  for(const c of flat){
    if(!valid.has(c[0]))throw new Error(`Duchy ${duchyId}: invalid terrain ${c[0]}`);
    if(!Number.isInteger(c[1])||c[1]<1||c[1]>6)throw new Error(`Duchy ${duchyId}: invalid die ${c[1]}`);
  }
  const starts=flat.filter(c=>c[2]==='start');
  if(starts.length!==1||starts[0][0]!=='castle'||starts[0][1]!==6)throw new Error(`Duchy ${duchyId}: starting castle must be a single die-6 castle`);
  const board=buildDuchyBoard(duchyId);
  if(board.length!==37)throw new Error(`Duchy ${duchyId}: build mismatch`);
  return true;
}
