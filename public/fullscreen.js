// Fullscreen stays on the document root while the app changes screens.
export function createFullscreenController({document: doc,onChange=()=>{},onUnavailable=()=>{},onError=()=>{}}) {
  let busy=false;
  const active=()=>Boolean(doc.fullscreenElement||doc.webkitFullscreenElement);
  const changed=()=>onChange({active:active(),busy});
  for(const event of ['fullscreenchange','webkitfullscreenchange'])doc.addEventListener(event,changed);
  return {
    get active(){return active();},
    get busy(){return busy;},
    async toggle(){
      if(busy)return;
      const root=doc.documentElement;
      const exit=doc.exitFullscreen||doc.webkitExitFullscreen;
      const standard=typeof root.requestFullscreen==='function'&&doc.fullscreenEnabled!==false;
      const legacy=typeof root.webkitRequestFullscreen==='function'&&doc.webkitFullscreenEnabled!==false;
      if(active()&&typeof exit!=='function'||!active()&&!standard&&!legacy){onUnavailable();return;}
      busy=true;changed();
      try {
        // Invoke directly in the click handler, before yielding user activation.
        if(active())await exit.call(doc);
        else if(standard)await root.requestFullscreen({navigationUI:'hide'});
        else await root.webkitRequestFullscreen();
      }catch(error){onError(error);}
      finally{busy=false;changed();}
    },
    destroy(){for(const event of ['fullscreenchange','webkitfullscreenchange'])doc.removeEventListener(event,changed);}
  };
}
