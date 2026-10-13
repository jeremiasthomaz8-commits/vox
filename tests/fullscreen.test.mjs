import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFullscreenController} from '../public/fullscreen.js';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/index.mjs';

test('the server serves the web-app manifest, fullscreen module and correctly sized install icons',async()=>{
  const db=openDatabase(':memory:'),{server}=await createApp({db,retentionInterval:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    const manifestResponse=await fetch(origin+'/manifest.webmanifest');
    assert.equal(manifestResponse.status,200);assert.match(manifestResponse.headers.get('content-type'),/application\/manifest\+json/);
    assert.match(manifestResponse.headers.get('permissions-policy'),/fullscreen=\(self\)/);
    const manifest=await manifestResponse.json();assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
    for(const size of [180,192,512]){
      const response=await fetch(origin+`/icons/vox-${size}.png`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/png/);
      const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
    }
    const script=await fetch(origin+'/fullscreen.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);await script.text();
    const html=await (await fetch(origin+'/')).text();assert.match(html,/rel="manifest"/);assert.match(html,/apple-touch-icon/);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('fullscreen enters on the document root, survives app redraws and tracks Escape',async()=>{
  const doc=new EventTarget(),root={},states=[];let requested=0,exited=0;
  Object.assign(doc,{documentElement:root,fullscreenEnabled:true,fullscreenElement:null});
  root.requestFullscreen=async()=>{requested++;doc.fullscreenElement=root;doc.dispatchEvent(new Event('fullscreenchange'));};
  doc.exitFullscreen=async()=>{exited++;doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));};
  const controller=createFullscreenController({document:doc,onChange:state=>states.push(state)});
  await controller.toggle();assert.equal(requested,1);assert.equal(controller.active,true);assert.equal(doc.fullscreenElement,root);
  doc.app={screen:'unit',ratings:[5,null]};assert.equal(controller.active,true);
  await controller.toggle();assert.equal(exited,1);assert.equal(controller.active,false);
  await controller.toggle();doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));
  assert.deepEqual(states.at(-1),{active:false,busy:false});assert.deepEqual(doc.app.ratings,[5,null]);controller.destroy();
});

test('repeated clicks do not race a pending fullscreen request',async()=>{
  const doc=new EventTarget();let resolveRequest,requests=0;
  doc.fullscreenEnabled=true;doc.documentElement={requestFullscreen:()=>{requests++;return new Promise(resolve=>{resolveRequest=resolve;});}};
  const controller=createFullscreenController({document:doc});
  const pending=controller.toggle();await controller.toggle();assert.equal(requests,1);assert.equal(controller.busy,true);
  resolveRequest();await pending;assert.equal(controller.busy,false);assert.equal(controller.active,false);
});

test('denied fullscreen does not report success and offers recovery',async()=>{
  const doc=new EventTarget(),errors=[];doc.fullscreenEnabled=true;
  doc.documentElement={requestFullscreen:async()=>{throw new Error('User activation denied');}};
  const controller=createFullscreenController({document:doc,onError:error=>errors.push(error)});
  await controller.toggle();assert.equal(errors.length,1);assert.equal(controller.active,false);assert.equal(controller.busy,false);
});

test('unsupported or policy-blocked browsers open installation guidance',async()=>{
  for(const documentElement of [{},{requestFullscreen:()=>{throw Error('Must not invoke a disabled API');}}]){
    const doc=new EventTarget();Object.assign(doc,{documentElement,fullscreenEnabled:false});let guided=0;
    const controller=createFullscreenController({document:doc,onUnavailable:()=>guided++});
    await controller.toggle();assert.equal(guided,1);assert.equal(controller.active,false);
  }
});

test('legacy Safari fullscreen events keep the control in sync',async()=>{
  const doc=new EventTarget();doc.webkitFullscreenEnabled=true;doc.documentElement={webkitRequestFullscreen:()=>{doc.webkitFullscreenElement=doc.documentElement;doc.dispatchEvent(new Event('webkitfullscreenchange'));}};
  doc.webkitExitFullscreen=()=>{doc.webkitFullscreenElement=null;doc.dispatchEvent(new Event('webkitfullscreenchange'));};
  const controller=createFullscreenController({document:doc});await controller.toggle();assert.equal(controller.active,true);
  await controller.toggle();assert.equal(controller.active,false);controller.destroy();
});
