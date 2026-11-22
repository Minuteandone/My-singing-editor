/* MSM Rig Lab — original Aniviewer hierarchy + non-destructive editing.
   Uses user-selected local files only. No bundled copyrighted game assets.
   Semantics modeled after Aniviewer's web-app/src/core/animation.ts. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const WIDTH=1000, HEIGHT=660, DECODER=new TextDecoder();
const state={zip:null,zipEntries:new Map(),files:new Map(),options:[],doc:null,track:null,atlas:new Map(),sceneByClip:{},
  selected:null,time:0,duration:0,playing:false,last:0,zoom:1.65,panX:0,panY:0,showJoints:true,drag:null,
  world:new Map(),states:new Map(),drawOrder:[],warned:new Set(),urls:[]};
const editDefault=()=>({x:0,y:0,rot:0,sx:1,sy:1});
const finite=(n,f=0)=>Number.isFinite(Number(n))?Number(n):f;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const copy=x=>JSON.parse(JSON.stringify(x));
const base=name=>String(name||'').replace(/\\/g,'/').split('/').pop().toLowerCase();
const stem=name=>base(name).replace(/\.(avif|png|webp|jpg|jpeg|xml|json)$/i,'');
function status(msg){$('message').textContent=msg;}
function fileStatus(msg){$('fileStatus').textContent=msg;}
function canvasMatrix(){return {z:state.zoom,tx:WIDTH/2+state.panX-state.zoom*(finite(state.track?.width,384)/2),ty:HEIGHT/2+state.panY-state.zoom*(finite(state.track?.height,384)/2)};}
function screenPoint(x,y){const m=canvasMatrix();return {x:m.tx+x*m.z,y:m.ty+y*m.z};}
function trackPoint(event){const bounds=canvas.getBoundingClientRect(),x=(event.clientX-bounds.left)*WIDTH/bounds.width,y=(event.clientY-bounds.top)*HEIGHT/bounds.height,m=canvasMatrix();return {x:(x-m.tx)/m.z,y:(y-m.ty)/m.z,px:x,py:y};}
function clearUrls(){for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];}
function setOptions(){const query=$('filterInput').value.trim().toLowerCase(),s=$('jsonSelect'),before=s.value;s.replaceChildren();
 const opts=state.options.filter(item=>base(item.name).includes(query)||item.name.toLowerCase().includes(query));
 if(!opts.length){const o=document.createElement('option');o.textContent='No matching JSON files';o.value='';s.append(o);return;}
 for(const item of opts){const o=document.createElement('option');o.value=item.key;o.textContent=item.name;s.append(o);}
 const previous=opts.some(i=>i.key===before)?before:(opts.find(i=>base(i.name)==='monster_cd.json')||opts[0]).key;
 s.value=previous;
}
function zipU16(d,o){return d.getUint16(o,true);}
function zipU32(d,o){return d.getUint32(o,true);}
async function indexZip(file){
 const tailLength=Math.min(65557,file.size),tailOffset=file.size-tailLength;
 const tail=new DataView(await file.slice(tailOffset).arrayBuffer());let eocd=-1;
 for(let p=tail.byteLength-22;p>=0;p--){if(zipU32(tail,p)===0x06054b50){eocd=p;break;}}
 if(eocd<0)throw Error('ZIP end directory not found.');
 const dirLen=zipU32(tail,eocd+12),dirOffset=zipU32(tail,eocd+16);
 if(dirOffset===0xffffffff||dirLen===0xffffffff)throw Error('ZIP64 is not supported; choose extracted assets.');
 if(dirLen>32_000_000)throw Error('Archive index is unexpectedly large.');
 const dir=new DataView(await file.slice(dirOffset,dirOffset+dirLen).arrayBuffer());
 let p=0;const out=new Map();
 while(p+46<=dir.byteLength){
  if(zipU32(dir,p)!==0x02014b50)break;
  const nameLen=zipU16(dir,p+28),extraLen=zipU16(dir,p+30),commentLen=zipU16(dir,p+32);
  if(p+46+nameLen+extraLen+commentLen>dir.byteLength)break;
  const path=DECODER.decode(new Uint8Array(dir.buffer,dir.byteOffset+p+46,nameLen));
  if(!path.endsWith('/'))out.set(path.toLowerCase(),{name:path,method:zipU16(dir,p+10),size:zipU32(dir,p+24),
   compressed:zipU32(dir,p+20),offset:zipU32(dir,p+42)});
  p+=46+nameLen+extraLen+commentLen;
 }
 if(!out.size)throw Error('No entries found in ZIP archive.');
 return out;
}
async function readZipEntry(entry){
 if(entry.size>80_000_000)throw Error('This individual asset is too large for the editor.');
 const f=state.zip,h=new DataView(await f.slice(entry.offset,entry.offset+30).arrayBuffer());
 if(zipU32(h,0)!==0x04034b50)throw Error('Invalid ZIP entry header: '+entry.name);
 const start=entry.offset+30+zipU16(h,26)+zipU16(h,28);
 const chunk=f.slice(start,start+entry.compressed);
 if(entry.method===0)return chunk.arrayBuffer();
 if(entry.method!==8)throw Error('Unsupported ZIP compression for '+entry.name);
 if(typeof DecompressionStream==='undefined')throw Error('Your browser cannot decompress ZIP files. Extract the matching JSON/XML/image and choose those instead.');
 try{return await new Response(chunk.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();}
 catch(err){throw Error('ZIP entry failed to decompress. Select extracted files instead: '+err.message);}
}
function findAsset(name){
 const lower=base(name);if(!lower)return null;
 for(const item of state.files.values())if(base(item.name)===lower)return {name:item.name,file:item};
 for(const item of state.zipEntries.values())if(base(item.name)===lower)return {name:item.name,entry:item};
 return null;
}
async function assetBytes(item){if(item.file)return item.file.arrayBuffer();return readZipEntry(item.entry);}
async function loadFiles(files){
 pause();clearUrls();state.zip=null;state.zipEntries=new Map();state.files=new Map();state.options=[];state.atlas=new Map();state.doc=null;state.track=null;state.sceneByClip={};state.selected=null;
 try{
  for(const f of files){if(/\.zip$/i.test(f.name)&&!state.zip){state.zip=f;state.zipEntries=await indexZip(f);}
   else state.files.set(f.name.toLowerCase(),f);}
  for(const [path,item]of state.zipEntries){if(path.endsWith('.json')&&path.includes('xml_bin/')&&/monster_/i.test(base(path)))state.options.push({key:'z:'+path,name:item.name});}
  for(const [path,file]of state.files){if(path.endsWith('.json'))state.options.push({key:'f:'+path,name:file.name});}
  if(!state.options.length)throw Error('No converted animation JSON found. Choose the JSON directly or a ZIP containing data/xml_bin/monster_*.json.');
  state.options.sort((a,b)=>a.name.localeCompare(b.name));
  setOptions();fileStatus(state.zip?state.zip.name+' · '+state.options.length+' animations':'Selected '+files.length+' file(s)');
  await loadSelectedJSON();
 }catch(e){fileStatus('Could not open files');status('⚠ '+e.message);}
}
function getSelectedAsset(){const key=$('jsonSelect').value;if(key.startsWith('z:')){const entry=state.zipEntries.get(key.slice(2));return entry?{entry,name:entry.name}:null;}
 if(key.startsWith('f:')){const file=state.files.get(key.slice(2));return file?{file,name:file.name}:null;}return null;}
async function loadSelectedJSON(){
 const choice=getSelectedAsset();if(!choice)return;
 pause();clearUrls();state.atlas.clear();status('Reading '+base(choice.name)+'…');
 try{
  const bytes=await assetBytes(choice),text=DECODER.decode(bytes),doc=JSON.parse(text);
  if(!Array.isArray(doc.anims)||!Array.isArray(doc.sources)||!doc.anims.length)throw Error('This is not an Aniviewer converted animation JSON (sources/anims missing).');
  state.doc=doc;state.sceneByClip={};state.selected=null;state.atlas.clear();
  const clip=$('clipSelect');clip.replaceChildren();
  for(let i=0;i<doc.anims.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=doc.anims[i].name||'Clip '+(i+1);clip.append(o);}
  for(const source of doc.sources){await loadSource(source);}
  clip.value='0';chooseClip(0);
  const loaded=[...state.atlas.values()].filter(x=>x.image).length;
  status('✅ '+doc.anims.length+' original clips loaded, '+loaded+'/'+doc.sources.length+' sprite atlases ready. Source frames are unchanged.');
 }catch(e){state.doc=null;state.track=null;status('⚠ '+e.message);console.error(e);}
}
function chooseImage(xmlImagePath,xmlName){
 const candidates=[stem(xmlImagePath),stem(xmlName)];
 for(const target of candidates){for(const ext of ['.avif','.png','.webp','.jpg','.jpeg']){
  const found=findAsset(target+ext);if(found)return found;
 }}return null;
}
async function loadSource(source){
 const xmlAsset=findAsset(source.src||'');if(!xmlAsset){state.warned.add('XML '+String(source.src));return;}
 try{
  const xmlString=DECODER.decode(await assetBytes(xmlAsset));
  const xml=new DOMParser().parseFromString(xmlString,'application/xml');
  if(xml.querySelector('parsererror'))throw Error('Invalid atlas XML');
  const root=xml.documentElement,hires=/^(true|1|yes)$/i.test(root.getAttribute('hires')||'');
  const imageAsset=chooseImage(root.getAttribute('imagePath')||'',source.src);
  if(!imageAsset){state.warned.add('Image for '+String(source.src));return;}
  const blob=new Blob([await assetBytes(imageAsset)],{type:/\.avif$/i.test(imageAsset.name)?'image/avif':/\.webp$/i.test(imageAsset.name)?'image/webp':'image/png'});
  const url=URL.createObjectURL(blob);state.urls.push(url);
  const img=new Image();img.src=url;await img.decode();
  const sprites=new Map();
  for(const el of xml.getElementsByTagName('sprite')){
   const n=el.getAttribute('n')||el.getAttribute('name')||'';
   if(!n)continue;
   const integer=(key,f=0)=>finite(el.getAttribute(key),f);
   const r=(el.getAttribute('r')||'').toLowerCase()==='y';
   const x=integer('x'),y=integer('y'),w=integer('w',integer('width')),h=integer('h',integer('height'));
   if(w<=0||h<=0)continue;
   const render=document.createElement('canvas');render.width=r?h:w;render.height=r?w:h;
   const c=render.getContext('2d');
   if(r){c.translate(0,w);c.rotate(-Math.PI/2);}
   c.drawImage(img,x,y,w,h,0,0,w,h);
   sprites.set(n.toLowerCase(),{canvas:render,x:integer('oX'),y:integer('oY'),width:render.width,height:render.height});
  }
  state.atlas.set(finite(source.id),{image:img,sprites,hires,source});
 }catch(e){state.warned.add('Atlas '+String(source.src));console.warn('Atlas load failed:',source.src,e);}
}
function newScene(){return {edits:{},limits:{},hidden:{},keys:[],ik:null};}
function scene(){if(!state.track)return newScene();const key=state.track.name||String($('clipSelect').value);return state.sceneByClip[key]??(state.sceneByClip[key]=newScene());}
function chooseClip(index){
 const t=state.doc?.anims[index];if(!t)return;pause();state.track=t;state.duration=Math.max(.04,...t.layers.flatMap(l=>(l.frames||[]).map(f=>Math.max(0,finite(f.time)))));
 state.time=0;state.selected=null;state.panX=state.panY=0;state.warned.clear();
 state.layersById=new Map(t.layers.map(l=>[finite(l.id),l]));
 $('clipHeading').textContent=t.name||'Animation';
 $('stageStats').textContent=t.layers.length+' source layers · '+state.duration.toFixed(2)+'s · '+state.atlas.size+' atlas(es)';
 $('timeInput').value='0';updateLayerList();updateInputs();render();updateTimeline();
}
function numericKeys(layer,channel,component,fallback,time){
 const frames=layer.frames||[];let previous=null,next=null;
 for(const f of frames){const v=f[channel];if(!v||finite(v.immediate,-1)===-1)continue;
  const k={time:Math.max(0,finite(f.time)),value:finite(component?v[component]:v.value,fallback),type:finite(v.immediate)};
  if(k.time<=time)previous=k;else{next=k;break;}
 }
 if(!previous){for(const f of frames){const v=f[channel];if(v&&finite(v.immediate,-1)!==-1)return finite(component?v[component]:v.value,fallback);}return fallback;}
 if(!next||previous.type!==0||next.time<=previous.time)return previous.value;
 const blend=clamp((time-previous.time)/(next.time-previous.time),0,1);return previous.value+(next.value-previous.value)*blend;
}
function spriteAt(layer,time){
 const frames=layer.frames||[];let last=null,upcoming=null;
 for(const f of frames){if(!f.sprite||finite(f.sprite.immediate,-1)===-1)continue;
  if(finite(f.time)<=time)last=f;else{upcoming=f;break;}
 }
 if(!last){last=frames.find(f=>f.sprite&&finite(f.sprite.immediate,-1)!==-1)||null;}
 if(!last)return '';
 const name=String(last.sprite.string||'');
 if(upcoming&&finite(last.sprite.immediate)===0){
  const ma=/^(.*?)(\d+)(\.[^.]*)?$/.exec(name),mb=/^(.*?)(\d+)(\.[^.]*)?$/.exec(String(upcoming.sprite.string||''));
  if(ma&&mb&&ma[1]===mb[1]&&(ma[3]||'')===(mb[3]||'')){
   const a=Number(ma[2]),b=Number(mb[2]),steps=Math.abs(b-a),span=finite(upcoming.time)-finite(last.time);
   if(steps&&span>0){const advance=Math.min(steps-1,Math.floor(clamp((time-finite(last.time))/span,0,.9999)*steps));
    return ma[1]+String(a+Math.sign(b-a)*advance).padStart(ma[2].length,'0')+(ma[3]||'');
   }
  }
 }
 return name;
}
function valuesAt(layer,time){
 return {x:numericKeys(layer,'pos','x',0,time),y:numericKeys(layer,'pos','y',0,time),sx:numericKeys(layer,'scale','x',100,time)/100,
 sy:numericKeys(layer,'scale','y',100,time)/100,rot:numericKeys(layer,'rotation',null,0,time),
 alpha:numericKeys(layer,'opacity',null,100,time)/100,depth:numericKeys(layer,'depth',null,0,time),
 sprite:spriteAt(layer,time)};
}
function mixEdits(a,b,t){
 const result={};for(const id of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){
  const ea={...editDefault(),...(a?.[id]||{})},eb={...editDefault(),...(b?.[id]||{})};
  result[id]={};for(const field of ['x','y','rot','sx','sy'])result[id][field]=ea[field]+(eb[field]-ea[field])*t;
 }return result;
}
function animatedEdits(s,time){
 const keys=s.keys;if(!keys.length)return {edits:s.edits,ik:s.ik};
 if(time<=keys[0].time)return {edits:keys[0].edits,ik:keys[0].ik||s.ik};
 if(time>=keys[keys.length-1].time)return {edits:keys[keys.length-1].edits,ik:keys[keys.length-1].ik||s.ik};
 for(let i=0;i<keys.length-1;i++){const a=keys[i],b=keys[i+1];if(time>=a.time&&time<=b.time){
  const ratio=(time-a.time)/(b.time-a.time||1),ik=copy(a.ik||s.ik);
  if(ik&&b.ik&&ik.endId===b.ik.endId){ik.x=ik.x+(b.ik.x-ik.x)*ratio;ik.y=ik.y+(b.ik.y-ik.y)*ratio;}
  return {edits:mixEdits(a.edits,b.edits,ratio),ik};
 }}return {edits:s.edits,ik:s.ik};
}
function compose(p,c){return {a:p.a*c.a+p.c*c.b,b:p.b*c.a+p.d*c.b,c:p.a*c.c+p.c*c.d,d:p.b*c.c+p.d*c.d,
 tx:p.a*c.tx+p.c*c.ty+p.tx,ty:p.b*c.tx+p.d*c.ty+p.ty};}
function buildStates(time,edits){
 const states=new Map(),busy=new Set(),layers=state.track.layers,map=state.layersById,s=scene();
 function evalLayer(layer){
  const id=finite(layer.id);if(states.has(id))return states.get(id);
  const value=valuesAt(layer,time),edit={...editDefault(),...(edits?.[id]||{})};
  let rot=value.rot+finite(edit.rot),sx=value.sx*finite(edit.sx,1),sy=value.sy*finite(edit.sy,1);
  const limit=s.limits?.[id];if(limit)rot=clamp(rot,finite(limit.min,-180),finite(limit.max,180));
  const theta=rot*Math.PI/180,c=Math.cos(theta),sn=Math.sin(theta);
  const a=sx*c,b=sx*sn,d=sy*c,cc=-sy*sn;
  const anchorMap=layer.sprite_anchor_map||{};
  const anchor=anchorMap[value.sprite]||Object.entries(anchorMap).find(([n])=>n.toLowerCase()===value.sprite.toLowerCase())?.[1];
  const ax=finite(anchor?.[0],finite(layer.anchor_x)),ay=finite(anchor?.[1],finite(layer.anchor_y));
  const px=value.x+finite(edit.x),py=value.y+finite(edit.y);
  const local={a,b,c:cc,d,tx:px-a*ax-cc*ay,ty:py-b*ax-d*ay};
  let world=local;
  const parent=map.get(finite(layer.parent,-1));
  if(parent&&!busy.has(finite(parent.id))){busy.add(id);world=compose(evalLayer(parent),local);busy.delete(id);}
  const final={...world,...value,ax,ay,id,layer};
  states.set(id,final);return final;
 }
 for(const l of layers)evalLayer(l);
 return states;
}
function pivot(world){return {x:world.a*world.ax+world.c*world.ay+world.tx,y:world.b*world.ax+world.d*world.ay+world.ty};}
function wrapAngle(deg){return ((deg+540)%360+360)%360-180;}
function solveIK(time,edits,ik){
 if(!ik?.enabled)return buildStates(time,edits);
 const end=state.layersById.get(finite(ik.endId)),mid=end&&state.layersById.get(finite(end.parent,-1)),root=mid&&state.layersById.get(finite(mid.parent,-1));
 if(!root)return buildStates(time,edits);
 let positions=buildStates(time,edits);
 let p0=pivot(positions.get(finite(root.id))),p1=pivot(positions.get(finite(mid.id))),p2=pivot(positions.get(finite(end.id)));
 const lenA=Math.hypot(p1.x-p0.x,p1.y-p0.y),lenB=Math.hypot(p2.x-p1.x,p2.y-p1.y);
 if(lenA<.001||lenB<.001)return positions;
 const dx=finite(ik.x)-p0.x,dy=finite(ik.y)-p0.y,d=Math.hypot(dx,dy)||.0001;
 const distance=clamp(d,Math.abs(lenA-lenB)+.0001,lenA+lenB-.0001),ux=dx/d,uy=dy/d;
 const along=(distance*distance+lenA*lenA-lenB*lenB)/(2*distance);
 const height=Math.sqrt(Math.max(0,lenA*lenA-along*along))*finite(ik.bend,1);
 const elbow={x:p0.x+ux*along-uy*height,y:p0.y+uy*along+ux*height};
 const angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
 const rootId=String(root.id),midId=String(mid.id);
 edits[rootId]={...editDefault(),...edits[rootId],rot:finite(edits[rootId]?.rot)+wrapAngle(angle(p0,elbow)-angle(p0,p1))};
 positions=buildStates(time,edits);p1=pivot(positions.get(finite(mid.id)));p2=pivot(positions.get(finite(end.id)));
 edits[midId]={...editDefault(),...edits[midId],rot:finite(edits[midId]?.rot)+wrapAngle(angle(p1,{x:ik.x,y:ik.y})-angle(p1,p2))};
 return buildStates(time,edits);
}
function calc(time,playing=false){
 const s=scene(),pose=playing?animatedEdits(s,time):{edits:s.edits,ik:s.ik};
 const edits=copy(pose.edits||{}),world=solveIK(time,edits,pose.ik);
 const depth=state.track.layers.some(l=>(l.frames||[]).some(f=>f.depth&&finite(f.depth.immediate,-1)!==-1));
 const ordered=state.track.layers.map((l,i)=>({l,i}));
 if(depth)ordered.sort((a,b)=>finite(world.get(finite(a.l.id))?.depth)-finite(world.get(finite(b.l.id))?.depth)||a.i-b.i);
 else ordered.reverse();
 state.world=world;state.drawOrder=ordered.map(o=>o.l);
 return world;
}
function spriteFor(layer,world){
 const source=state.atlas.get(finite(layer.src,0));return source?.sprites.get(world.sprite.toLowerCase())?{...source.sprites.get(world.sprite.toLowerCase()),hires:source.hires}:null;
}
function render(){
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,WIDTH,HEIGHT);
 ctx.fillStyle='#0d1c2b';ctx.fillRect(0,0,WIDTH,HEIGHT);
 ctx.lineWidth=1;ctx.strokeStyle='#203449';ctx.beginPath();
 for(let x=0;x<WIDTH;x+=40){ctx.moveTo(x,0);ctx.lineTo(x,HEIGHT);}for(let y=0;y<HEIGHT;y+=40){ctx.moveTo(0,y);ctx.lineTo(WIDTH,y);}ctx.stroke();
 if(!state.track){ctx.textAlign='center';ctx.fillStyle='#b8cfdf';ctx.font='19px system-ui';ctx.fillText('Choose your MSM data.zip or an Aniviewer JSON + XML + image',WIDTH/2,HEIGHT/2);return;}
 const s=scene(),world=calc(state.time,state.playing),m=canvasMatrix();
 ctx.save();ctx.setTransform(m.z,0,0,m.z,m.tx,m.ty);
 // Stage bounds are based on the authoring animation size.
 ctx.fillStyle='#14273b';ctx.fillRect(0,0,finite(state.track.width,384),finite(state.track.height,384));
 ctx.strokeStyle='#47627c';ctx.lineWidth=.65;ctx.strokeRect(0,0,finite(state.track.width,384),finite(state.track.height,384));
 for(const layer of state.drawOrder){
  const id=finite(layer.id),w=world.get(id);if(!w||s.hidden?.[id]||w.alpha<=0)continue;
  const sprite=spriteFor(layer,w);if(!sprite)continue;
  ctx.save();ctx.globalAlpha=clamp(w.alpha,0,1);
  const blend=finite(layer.blend);if(blend===1||blend===2)ctx.globalCompositeOperation='lighter';else if(blend===6)ctx.globalCompositeOperation='multiply';else if(blend===7)ctx.globalCompositeOperation='screen';
  ctx.transform(w.a,w.b,w.c,w.d,w.tx,w.ty);
  const factor=sprite.hires?2:1;
  ctx.drawImage(sprite.canvas,sprite.x/factor,sprite.y/factor,sprite.width/factor,sprite.height/factor);
  ctx.restore();
 }
 if(state.showJoints){
  for(const layer of state.track.layers){const w=world.get(finite(layer.id));if(!w)continue;
   const parent=world.get(finite(layer.parent,-1)),p=pivot(w);
   if(parent){const pp=pivot(parent);ctx.strokeStyle='#6499b088';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pp.x,pp.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
  }
  for(const layer of state.track.layers){const w=world.get(finite(layer.id));if(!w)continue;const p=pivot(w),selected=state.selected===finite(layer.id);
   ctx.beginPath();ctx.arc(p.x,p.y,selected?5.5:3.1,0,Math.PI*2);ctx.fillStyle=selected?'#ffcf75':'#6de6e5';ctx.fill();ctx.strokeStyle='#0a1a28';ctx.lineWidth=1;ctx.stroke();
   if(selected){ctx.font='10px system-ui';ctx.fillStyle='#f3f8fc';ctx.fillText(layer.name,p.x+7,p.y-7);}
  }
 }
 const ik=state.playing?animatedEdits(s,state.time).ik:s.ik;
 if(ik?.enabled){ctx.beginPath();ctx.moveTo(ik.x-8,ik.y);ctx.lineTo(ik.x+8,ik.y);ctx.moveTo(ik.x,ik.y-8);ctx.lineTo(ik.x,ik.y+8);ctx.strokeStyle='#e5a7ff';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(ik.x,ik.y,6,0,Math.PI*2);ctx.stroke();}
 ctx.restore();
}
function layerDepth(id){let depth=0,layer=state.layersById.get(id),visited=new Set();
 while(layer&&!visited.has(layer.id)&&depth<12){visited.add(layer.id);layer=state.layersById.get(finite(layer.parent,-1));if(layer)depth++;}
 return depth;
}
function updateLayerList(){
 const list=$('layerList');list.replaceChildren();if(!state.track)return;
 for(const layer of state.track.layers){const id=finite(layer.id),button=document.createElement('button'),depth=layerDepth(id);
  button.type='button';button.style.paddingLeft=(8+depth*14)+'px';button.textContent=(id===state.selected?'◆ ':'◇ ')+layer.name+' · '+id;
  if(id===state.selected)button.classList.add('selected');
  button.addEventListener('click',()=>{state.selected=id;updateLayerList();updateInputs();render();});list.append(button);
 }
}
function updateInputs(){
 const id=state.selected,layer=state.layersById?.get(id),s=scene(),edit={...editDefault(),...s.edits[id]};
 $('selectedName').textContent=layer?layer.name+'  (#'+id+')':'None selected';
 $('layerDetails').textContent=layer?'Parent #'+layer.parent+' · source #'+layer.src+' · '+(layer.frames?.length||0)+' original keyframes':'Select a sprite or a layer in the hierarchy.';
 for(const [field,name]of [['x','offsetX'],['y','offsetY'],['rot','rotation'],['sx','scaleX'],['sy','scaleY']])$(name).value=edit[field];
 const limit=s.limits?.[id]||{min:-180,max:180};$('minAngle').value=limit.min;$('maxAngle').value=limit.max;
 $('visible').value=s.hidden?.[id]?'no':'yes';
 const ik=s.ik;$('ikX').value=ik?.x??0;$('ikY').value=ik?.y??0;$('ikBend').value=String(ik?.bend??1);$('ikEnabled').checked=Boolean(ik?.enabled);
 $('ikStatus').textContent=ik?'Endpoint #'+ik.endId+' · draggable purple target':'No IK chain set';
}
function updateTimeline(){
 if(!state.track){$('timeText').textContent='0.00s / 0.00s';return;}
 $('timeInput').value=String(Math.round(1000*state.time/state.duration));
 $('timeText').textContent=state.time.toFixed(2)+'s / '+state.duration.toFixed(2)+'s · '+Math.round(state.time*24)+'f @24 FPS';
 const keys=scene().keys;$('keyText').textContent=keys.length?keys.map(k=>k.time.toFixed(2)+'s').join(' · '):'No editable keyframes';
}
function pause(){state.playing=false;$('playButton').textContent='▶ Play';}
function tick(now){
 if(!state.playing)return;
 state.time+=Math.min(.1,(now-state.last)/1000)*finite($('speedSelect').value,1);state.last=now;
 if(state.time>state.duration)state.time%=state.duration;
 render();updateTimeline();requestAnimationFrame(tick);
}
function ensureEdit(){if(!state.track||state.selected===null)return null;const s=scene(),id=String(state.selected);return s.edits[id]??(s.edits[id]=editDefault());}
function changeSelected(field,value){
 const e=ensureEdit();if(!e)return;pause();e[field]=field==='sx'||field==='sy'?clamp(finite(value,1),.1,5):clamp(finite(value),-2000,2000);render();
}
for(const [input,field]of [['offsetX','x'],['offsetY','y'],['rotation','rot'],['scaleX','sx'],['scaleY','sy']]){
 $(input).addEventListener('input',ev=>changeSelected(field,ev.target.value));
}
for(const field of ['minAngle','maxAngle'])$(field).addEventListener('input',()=>{
 if(state.selected===null)return;const s=scene(),id=state.selected;s.limits[id]={min:finite($('minAngle').value,-180),max:finite($('maxAngle').value,180)};
 if(s.limits[id].min>s.limits[id].max)s.limits[id].max=s.limits[id].min;render();
});
$('visible').addEventListener('change',ev=>{if(state.selected===null)return;scene().hidden[state.selected]=ev.target.value==='no';render();});
$('resetLayerButton').addEventListener('click',()=>{if(state.selected===null)return;const s=scene();delete s.edits[state.selected];delete s.limits[state.selected];delete s.hidden[state.selected];updateInputs();render();});
$('resetAllButton').addEventListener('click',()=>{if(!state.track)return;const s=scene();s.edits={};s.limits={};s.hidden={};s.keys=[];s.ik=null;updateInputs();updateTimeline();render();});
$('ikCreateButton').addEventListener('click',()=>{
 const end=state.layersById?.get(state.selected),mid=end&&state.layersById.get(finite(end.parent,-1)),root=mid&&state.layersById.get(finite(mid.parent,-1));
 if(!root){status('Select a layer with a parent AND grandparent for a two-joint IK chain. Fwog’s original feet are roots, so its limbs need additional constructed joints for this particular IK method.');return;}
 const positions=calc(state.time),p=pivot(positions.get(finite(end.id)));
 scene().ik={endId:finite(end.id),x:p.x,y:p.y,bend:1,enabled:true};updateInputs();render();status('IK attached: '+root.name+' → '+mid.name+' → '+end.name);
});
$('ikRemoveButton').addEventListener('click',()=>{scene().ik=null;updateInputs();render();});
for(const [input,field]of [['ikX','x'],['ikY','y'],['ikBend','bend']])$(input).addEventListener('input',()=>{
 const ik=scene().ik;if(!ik)return;pause();ik[field]=finite($(input).value);render();
});
$('ikEnabled').addEventListener('change',()=>{if(!scene().ik)return;scene().ik.enabled=$('ikEnabled').checked;render();});
function pickLayer(point){
 const world=state.world;
 // Prefer nearby rig joints, then a visible sprite hit-test in reverse draw order.
 let best=null,dist=11/state.zoom;
 for(const l of state.track.layers){const w=world.get(finite(l.id));if(!w)continue;const p=pivot(w),d=Math.hypot(point.x-p.x,point.y-p.y);if(d<dist){best=finite(l.id);dist=d;}}
 if(best!==null)return best;
 for(const l of [...state.drawOrder].reverse()){
  const id=finite(l.id),w=world.get(id),sprite=w&&spriteFor(l,w);if(!sprite||scene().hidden?.[id])continue;
  const det=w.a*w.d-w.b*w.c;if(Math.abs(det)<1e-10)continue;
  const dx=point.x-w.tx,dy=point.y-w.ty;
  const px=(w.d*dx-w.c*dy)/det,py=(-w.b*dx+w.a*dy)/det,scale=sprite.hires?2:1;
  if(px>=sprite.x/scale&&py>=sprite.y/scale&&px<=(sprite.x+sprite.width)/scale&&py<=(sprite.y+sprite.height)/scale)return id;
 }return null;
}
canvas.addEventListener('pointerdown',ev=>{
 if(!state.track)return;pause();render();const p=trackPoint(ev),ik=scene().ik;
 if(ik?.enabled&&Math.hypot(p.x-ik.x,p.y-ik.y)<13/state.zoom)state.drag={type:'ik',last:p};
 else{const id=pickLayer(p);if(id!==null){state.selected=id;updateLayerList();updateInputs();state.drag={type:'layer',last:p};}
 else state.drag={type:'pan',last:p};}
 canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove',ev=>{
 if(!state.drag||!state.track)return;const p=trackPoint(ev),last=state.drag.last,dx=p.x-last.x,dy=p.y-last.y;
 if(state.drag.type==='pan'){state.panX+=(p.px-last.px);state.panY+=(p.py-last.py);}
 else if(state.drag.type==='ik'){const ik=scene().ik;ik.x+=dx;ik.y+=dy;$('ikX').value=ik.x.toFixed(1);$('ikY').value=ik.y.toFixed(1);}
 else{const l=state.layersById.get(state.selected),parent=state.world.get(finite(l.parent,-1));let lx=dx,ly=dy;
  if(parent){const det=parent.a*parent.d-parent.b*parent.c;if(Math.abs(det)>1e-8){lx=(parent.d*dx-parent.c*dy)/det;ly=(-parent.b*dx+parent.a*dy)/det;}}
  const edit=ensureEdit();edit.x+=lx;edit.y+=ly;$('offsetX').value=edit.x.toFixed(2);$('offsetY').value=edit.y.toFixed(2);
 }
 state.drag.last=p;render();
});
const stopDrag=()=>state.drag=null;canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
$('centerButton').addEventListener('click',()=>{state.panX=state.panY=0;render();});
$('zoomInput').addEventListener('input',()=>{state.zoom=finite($('zoomInput').value,1.65);render();});
$('handlesInput').addEventListener('change',()=>{state.showJoints=$('handlesInput').checked;render();});
$('playButton').addEventListener('click',()=>{
 if(!state.track)return;state.playing=!state.playing;$('playButton').textContent=state.playing?'⏸ Pause':'▶ Play';
 if(state.playing){state.last=performance.now();requestAnimationFrame(tick);}
});
$('timeInput').addEventListener('input',()=>{
 if(!state.track)return;pause();state.time=state.duration*finite($('timeInput').value)/1000;
 const keys=scene().keys;if(keys.length){const pose=animatedEdits(scene(),state.time);scene().edits=copy(pose.edits);
  if(scene().ik&&pose.ik){scene().ik.x=pose.ik.x;scene().ik.y=pose.ik.y;}updateInputs();}
 render();updateTimeline();
});
$('keyButton').addEventListener('click',()=>{
 if(!state.track)return;pause();const s=scene(),time=Math.round(state.time*1000)/1000;
 s.keys=s.keys.filter(k=>Math.abs(k.time-time)>.001);s.keys.push({time,edits:copy(s.edits),ik:copy(s.ik)});
 s.keys.sort((a,b)=>a.time-b.time);updateTimeline();status('◆ Added editable pose keyframe at '+time.toFixed(3)+'s.');
});
$('deleteKeyButton').addEventListener('click',()=>{
 const s=scene(),n=s.keys.length;s.keys=s.keys.filter(k=>Math.abs(k.time-state.time)>.025);
 updateTimeline();if(n===s.keys.length)status('No nearby editable keyframe to remove.');
});
$('clipSelect').addEventListener('change',()=>chooseClip(finite($('clipSelect').value)));
$('filterInput').addEventListener('input',setOptions);
$('jsonSelect').addEventListener('change',loadSelectedJSON);
$('fileInput').addEventListener('change',ev=>{const f=[...ev.target.files];if(f.length)loadFiles(f);});
$('clearButton').addEventListener('click',()=>{pause();clearUrls();state.doc=null;state.track=null;state.files.clear();state.zip=null;state.zipEntries.clear();state.options=[];state.atlas.clear();state.sceneByClip={};state.selected=null;$('filterInput').value='';setOptions();fileStatus('No assets selected');$('layerList').replaceChildren();$('clipSelect').replaceChildren();updateInputs();render();});
function download(name,mime,data){
 const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10_000);
}
$('exportButton').addEventListener('click',()=>{
 if(!state.doc){status('Load your Aniviewer JSON first.');return;}
 const info={format:'MSM-Rig-Lab-edits-v2',source:base(getSelectedAsset()?.name),activeClip:state.track?.name,
  scenes:state.sceneByClip,notes:'Non-destructive enhancements only. Re-import original Aniviewer JSON and matching sprites.'};
 download('MSM_rig_lab_edits.json','application/json',JSON.stringify(info,null,2));status('Saved an editable project with layer offsets, keyframes, IK and constraints.');
});
$('importEditsButton').addEventListener('click',()=>$('editsInput').click());
$('editsInput').addEventListener('change',async ev=>{
 const file=ev.target.files[0];if(!file)return;
 try{const data=JSON.parse(await file.text());if(data.format!=='MSM-Rig-Lab-edits-v2'||!data.scenes||typeof data.scenes!=='object')throw Error('Not a Rig Lab edits file');
  if(!state.doc)throw Error('Load the source animation JSON first.');
  state.sceneByClip=data.scenes;updateInputs();updateTimeline();render();status('✅ Re-imported editable layer controls.');
 }catch(e){status('⚠ '+e.message);}finally{ev.target.value='';}
});
$('exportPNGButton').addEventListener('click',()=>{
 if(!state.track)return;const guides=state.showJoints;state.showJoints=false;render();
 canvas.toBlob(blob=>{if(blob)download((state.track.name||'monster')+'_'+Math.round(state.time*24)+'.png','image/png',blob);
 state.showJoints=guides;render();},'image/png');
});
$('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
$('helpClose').addEventListener('click',()=>$('helpDialog').close());
$('helpDialog').addEventListener('click',ev=>{if(ev.target===$('helpDialog'))$('helpDialog').close();});
render();
})();