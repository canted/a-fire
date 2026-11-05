import { expect, it } from 'vitest';
import { selectWallProcess, type WallProcessEntry, type WallFeedback } from '../../../../frontend/src/features/rooms/wall/selectWallProcess';
const entry = (id:string,date:string,project=id):WallProcessEntry => ({id,date,project,dateLabel:date,entry:{format:'mixed_media',format_data:null,content:{type:'doc',content:[]}}});
const feedback = (id:string,entryId:string,savedAt:string):WallFeedback => ({id,entryId,savedAt,author:'Peer',text:'A useful response',sourceTitle:'Earlier entry'});
it('keeps entries chronological across projects while allocating latest context first',()=>{
 const slots=selectWallProcess([entry('new','2026-10-28'),entry('old','2026-10-26'),entry('middle','2026-10-27')]);
 expect(slots.map(s=>s.entry.id)).toEqual(['old','middle','new']);
});
it('selects the first saved response to this exact entry, not another entry in its project',()=>{
 const newest={...entry('new','2026-10-28'),savedResponses:[feedback('other','other','2026-10-01'),feedback('later','new','2026-10-30'),feedback('first','new','2026-10-29')]};
 const slots=selectWallProcess([newest,entry('old','2026-10-27')]);
 expect(slots.map(s=>s.kind)).toEqual(['entry','entry','feedback']);
 expect(slots[2]).toMatchObject({feedback:{id:'first'}});
});
it('keeps selected older feedback with its entry across intervening projects',()=>{
 const slots=selectWallProcess([{...entry('new','2026-10-28'),touchstones:[feedback('touchstone','old','2026-10-20')]},entry('unrelated','2026-10-27')]);
 expect(slots.map(s=>[s.kind,s.entry.id])).toEqual([['entry','unrelated'],['feedback','new'],['entry','new']]);
});
it('never includes orphan context or exceeds three slots; statement and saved response take priority',()=>{
 const newest={...entry('new','2026-10-28'),statement:'My question',savedResponses:[feedback('response','new','2026-10-29')],touchstones:[feedback('touchstone','old','2026-10-20')]};
 expect(selectWallProcess([newest,entry('old','2026-10-27')]).map(s=>s.kind)).toEqual(['statement','entry','feedback']);
 expect(selectWallProcess([newest],1).map(s=>s.kind)).toEqual(['entry']);
 expect(selectWallProcess([],3)).toEqual([]);
});
