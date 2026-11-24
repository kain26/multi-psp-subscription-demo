import * as THREE from './vendor/three.module.min.js';
import {base,scenarios} from './scenarios.js';

const $=id=>document.getElementById(id);
const stage=$('scene');
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const tones={blue:0x95acfa,green:0x7be7c6,amber:0xffc47d,pink:0xff91ab,plate:0x192d40,side:0x36516a};
const hex=key=>'#'+tones[key].toString(16).padStart(6,'0');
const v=(x,y,z)=>new THREE.Vector3(x,y,z);
const ports={
  client:['Frontend','套餐 · 国家 · 币种','blue',[-7.05,-2.3],[-4,-4.8]],
  api:['Payment API','订阅服务','blue',[-4.2,-2.3],[0,-4.8]],
  router:['Router','初始选路','blue',[-1,-2.3],[4,-4.8]],
  adapter:['Provider Adapter','Stripe / PayPal / …','blue',[2.3,-2.3],[-4,-1.65]],
  stripe:['Stripe','','green',[5.75,-3],[0,-1.65]],
  paypal:['PayPal','','green',[7.25,-1.05],[4,-1.65]],
  other:['Other PSP','','green',[6.75,0.8],[4,1.45]],
  webhook:['Webhook Handler','验签 · Inbox','green',[4.1,1.6],[0,1.45]],
  queue:['Queue / Worker','异步投递','green',[1.03,2.6],[-4,1.45]],
  billing:['Billing / 权益','状态机 · Credits','green',[-2.35,2.6],[0,4.7]],
  store:['Database','Intent · Inbox · Outbox','amber',[-6.4,2.65],[-4,4.7]],
  reconcile:['Reconciliation','查询 · 补偿','amber',[-3.15,4.74],[4,4.7]],
};
const routes=[
  ['client','api','blue'],['api','router','blue'],['router','adapter','blue'],['adapter','stripe','blue'],
  ['adapter','paypal','blue'],['adapter','other','blue'],['stripe','webhook','green'],['paypal','webhook','green'],
  ['webhook','store','green'],['store','queue','green'],['queue','billing','green'],['billing','store','green'],
  ['store','reconcile','amber'],['reconcile','stripe','amber'],['reconcile','queue','amber'],
];
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera();
const projected=new THREE.Vector3();
let renderer,flat;
try{
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
}catch{flat=document.createElement('canvas').getContext('2d');}
const canvas=renderer?.domElement??flat.canvas;
canvas.setAttribute('aria-hidden','true');
stage.prepend(canvas);
scene.add(new THREE.HemisphereLight(0xe6f3ff,0x3a5270,2.35));
const key=new THREE.DirectionalLight(0xffe6cb,2.6);
key.position.set(-5,8,6);
scene.add(key);

function mesh(geometry,tone){
  const color=tones[tone];
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.05,roughness:.45,metalness:.24}));
  scene.add(mesh);
  return mesh;
}
const tile=(w,h,d,tone)=>mesh(new THREE.BoxGeometry(w,h,d),tone);
const floor=tile(1,.24,1,'plate');
const grid=new THREE.GridHelper(1,30,0x42607a,0x30485e);
grid.material.transparent=true;
grid.material.opacity=.44;
scene.add(grid);
const nodes={};
for(const [id,[name,hint,tone]] of Object.entries(ports)){
  const label=document.createElement('div');
  label.className='pin';
  label.style.setProperty('--tone',hex(tone));
  label.textContent=name;
  let small=null;
  if(hint){
    small=document.createElement('small');
    small.textContent=hint;
    label.append(small);
  }
  $('labels').append(label);
  nodes[id]={label,small,base:tile(1,.19,1,'side'),top:tile(1,.15,1,tone),tone};
}
const pathGeometry=new THREE.BufferGeometry();
pathGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(23*3),3));
const activeLine=new THREE.Line(pathGeometry,new THREE.LineBasicMaterial({color:tones.amber}));
activeLine.frustumCulled=false;
scene.add(activeLine);
const flight=$('flight');
const flightLabel=flight.querySelector('span');
const flights=1050;
const dwell=1850;
let width=1,height=1,world={},lines=[];
let scenario=scenarios[0],step=0,state={...base},pending=null,lastEvent=null;
let playing=false,paused=false,clock=0,nextAt=0,previous,frameId=0;

function layout(small){
  floor.scale.set(small?12.25:17.7,1,small?12.3:10.6);
  floor.position.set(0,-.21,small?-.15:.35);
  grid.scale.set(floor.scale.x-.12,1,floor.scale.z-.12);
  grid.position.copy(floor.position);
  grid.position.y=-.083;
  world=Object.fromEntries(Object.entries(ports).map(([id,port])=>{
    const [x,z]=port[small?4:3];
    return [id,v(x,.03,z)];
  }));
  for(const [id,node] of Object.entries(nodes)){
    const {x,z}=world[id];
    node.base.position.set(x,.001,z);
    node.base.scale.set(1.85,1,1.16);
    node.top.position.set(x,.15,z);
    node.top.scale.set(1.59,1,.93);
  }
  for(const {line} of lines){scene.remove(line);line.geometry.dispose();line.material.dispose();}
  lines=routes.map(([from,to,tone])=>{
    const points=[world[from],world[to]];
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({color:tones[tone],transparent:true,opacity:.55}));
    scene.add(line);
    return {line,points,tone};
  });
}
function screen(point){
  projected.copy(point).project(camera);
  return [(projected.x+1)*width/2,(1-projected.y)*height/2];
}
function label(node,point,clamp=false){
  let [x,y]=screen(point);
  if(clamp){
    const dx=node.offsetWidth/2+5,dy=node.offsetHeight/2+5;
    x=Math.max(dx,Math.min(width-dx,x));
    y=Math.max(dy,Math.min(height-dy,y));
  }
  node.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
}
function fallback(points,tone){
  flat.beginPath();
  for(const [i,point] of points.entries()){
    const [x,y]=screen(point);
    if(i===0)flat.moveTo(x,y);else flat.lineTo(x,y);
  }
  flat.strokeStyle=hex(tone);
  flat.stroke();
}
function paint(){
  const event=pending?.event??lastEvent;
  for(const [id,node] of Object.entries(nodes)){
    const on=event?.to===id||event?.from===id;
    node.top.material.emissiveIntensity=on ? .58 : .07;
    node.label.classList.toggle('active',on);
    const point=world[id];
    label(node.label,v(point.x,.62,point.z));
  }
  activeLine.visible=Boolean(event);
  if(event){
    const target=world[event.to];
    const from=world[event.from];
    const blocked=event.kind==='blocked';
    const end=from.clone().lerp(target,blocked ? .63 : 1);
    const a=from.clone().setY(.64),b=end.clone().setY(.64);
    const raised=a.clone().lerp(b,.5).add(v(0,2,0));
    const path=new THREE.QuadraticBezierCurve3(a,raised,b);
    activeLine.geometry.setFromPoints(path.getPoints(22));
    activeLine.material.color.setHex(tones[blocked?'pink':event.kind==='ok'?'green':'amber']);
    flight.hidden=!pending||reduce.matches;
    if(!flight.hidden)label(flight,path.getPoint(Math.min(1,(clock-pending.start)/flights)),true);
  }else flight.hidden=true;
  if(renderer)renderer.render(scene,camera);
  else{
    flat.clearRect(0,0,width,height);
    for(const {points,tone} of lines)fallback(points,tone);
    if(event)fallback([world[event.from],world[event.to]],event.kind==='blocked'?'pink':'amber');
  }
}

const fields=[['checkout','Checkout 尝试'],['payment','Payment'],['invoice','Invoice'],['subscription','Subscription'],['entitlement','Entitlement']];
const readouts={};
for(const [id,name] of fields){
  const card=document.createElement('div');
  const heading=document.createElement('span');
  heading.textContent=name;
  const value=document.createElement('b');
  readouts[id]=value;
  card.append(heading,value);
  $('status').append(card);
}
const metrics=document.createElement('div');
metrics.className='metrics';
$('status').append(metrics);
function renderState(){
  nodes.adapter.small.textContent=state.provider ? state.provider+' Adapter' : 'Stripe / PayPal / …';
  for(const [id,element] of Object.entries(readouts)) element.textContent=state[id];
  metrics.textContent=`意图 ${state.intents} · PSP 对象 ${state.sessions} · Inbox ${state.inbox} · Outbox 待发送 ${state.pending} · Credits 入账笔数 ${state.credits}`;
}
function explain(event){
  $('action').textContent=event?.op??'';
  $('result').textContent=event?.result??'';
  $('result').parentElement.dataset.kind=event?.kind??'';
  $('caption').textContent=event?.note??'点「播放演示」，或用「下一步」逐次讲解调用与状态变化。';
}
function controls(){
  $('play').textContent=playing?'暂停':paused?'继续播放':step===scenario.steps.length&&!pending?'重播演示':step?'继续播放':'播放演示';
  $('previous').disabled=step===0;
  $('next').disabled=step===scenario.steps.length;
  $('progress').textContent=`${step} / ${scenario.steps.length} 步`;
}
function commitEvent(event){state={...state,...event.patch};lastEvent=event;}
function finish(){
  if(!pending)return;
  commitEvent(pending.event);
  pending=null;
  nextAt=clock+dwell;
  renderState();
  explain(lastEvent);
  controls();
}
function next(){
  if(step===scenario.steps.length)return false;
  finish();
  const event=scenario.steps[step++];
  pending={event,start:clock};
  flightLabel.textContent=event.op;
  $('action').textContent=event.op;
  $('result').textContent='传递中…';
  if(reduce.matches)finish();
  controls();
  requestFrame();
  return true;
}
function goTo(index){
  state={...base,...scenario.initial};
  pending=lastEvent=null;
  playing=paused=false;
  previous=undefined;
  clock=0;
  nextAt=dwell;
  step=index;
  scenario.steps.slice(0,index).forEach(commitEvent);
  renderState();
  explain(lastEvent);
  controls();
  requestFrame();
}
function select(index){
  scenario=scenarios[index];
  Array.from($('scenarios').children).forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  $('scenarioTitle').textContent=scenario.title;
  $('scenarioSummary').textContent=scenario.summary;
  goTo(0);
}
function requestFrame(){if(!frameId)frameId=requestAnimationFrame(frame);}
function frame(timestamp){
  frameId=0;
  if(!paused){
    clock+=previous===undefined?0:Math.min(timestamp-previous,90);
    if(pending&&clock-pending.start>=flights)finish();
    if(playing&&!pending&&clock>=nextAt&&!next()){playing=false;controls();}
  }
  previous=timestamp;
  if(world.client)paint();
  if(!paused&&(playing||pending))requestFrame();else previous=undefined;
}
function resize(){
  ({width,height}=stage.getBoundingClientRect());
  if(!width||!height)return;
  const small=width<710;
  layout(small);
  camera.position.set(small?1.4:5.45,small?18:13.8,small?13:18.2);
  camera.lookAt(0,0,.1);
  const aspect=width/height;
  const h=Math.max(small?6.6:4.7,(small?6.75:9.4)/aspect);
  camera.left=-h*aspect;
  camera.right=h*aspect;
  camera.top=h;
  camera.bottom=-h;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if(renderer)renderer.setSize(width,height,false);else{canvas.width=width;canvas.height=height;}
  requestFrame();
}

scenarios.forEach(({name},i)=>{
  const button=document.createElement('button');
  button.type='button';
  button.textContent=name;
  button.onclick=()=>select(i);
  $('scenarios').append(button);
});
$('play').onclick=()=>{
  if(playing){playing=false;paused=true;}
  else{
    if(!paused&&step===scenario.steps.length&&!pending)goTo(0);
    paused=false;playing=true;
    if(!step)next();
  }
  controls();requestFrame();
};
$('previous').onclick=()=>goTo(Math.max(0,step-1));
$('next').onclick=()=>{playing=paused=false;next();};
$('reset').onclick=()=>goTo(0);
const requested=new URLSearchParams(location.search).get('demo');
select(Math.max(0,scenarios.findIndex(({id})=>id===requested)));
new ResizeObserver(resize).observe(stage);
resize();
