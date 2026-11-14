/**
 * The globe gallery (M4), styled after oumahi.art's index sphere: a see-through CSS 3D sphere of
 * hard-edged image frames (true aspect ratio, varied size and depth), with a glowing center dot per frame, a slow auto-spin with a gentle roll, and
 * drag-to-rotate with eased momentum. Rendered inside a WebView.
 *
 * Commands from React Native (injectJavaScript):
 *   G.setTiles([{id, img, tint?, tint2?, kind, label?}], {fill?, arrive?})
 *       diffed against the current sphere: new tiles fly out from the core (a new blend painting
 *       also gets focus + a gold flare), removed tiles fade, everything else glides to its slot.
 *       fill (default true): repeat small sets to 36 so the sphere reads as a sphere; false shows
 *       each tile once.
 *       arrive: id of a tile that lands last with focus + flare, even on the first build.
 *   G.glowPairs([[idA, idB], ...])                         matched pairs pull together and glow
 *   G.fold()                                               tiles fold into the center
 *   G.unfold()
 *   G.setEmblem(text)                                      counter-rotating label at the core
 * Messages to React Native: {type:"tap", id}, {type:"ready"}
 */
export const GLOBE_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  :root{--paper:#E8E6DE;--alert:#FF3B1F;--gold:#E8C47A;--ease:cubic-bezier(.2,.8,.2,1)}
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;
    touch-action:none;-webkit-touch-callout:none;font-family:ui-monospace,Menlo,Consolas,monospace}
  #stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;perspective:1400px;cursor:grab}
  #stage.grabbing{cursor:grabbing}
  #world{position:relative;width:1px;height:1px;transform-style:preserve-3d;will-change:transform}
  .n{position:absolute;top:0;left:0;transform-style:preserve-3d;cursor:pointer;
    transition:transform 1.2s var(--ease),opacity .9s ease,width .5s ease,height .5s ease,margin .5s ease}
  .n .f{position:relative;width:100%;height:100%;overflow:hidden;background:#000;transition:box-shadow .6s ease,filter .6s ease}
  .n img{width:100%;height:100%;object-fit:cover;display:block;-webkit-user-drag:none;
    filter:grayscale(35%) contrast(1.05) brightness(.9);transition:filter .25s ease,transform .4s ease}
  .n .f::after{content:"";position:absolute;top:50%;left:50%;width:5px;height:5px;border-radius:50%;
    background:var(--paper);transform:translate(-50%,-50%);z-index:2;pointer-events:none;
    box-shadow:0 0 0 3px rgba(10,10,11,.65),0 0 6px rgba(232,230,222,1),0 0 16px rgba(232,230,222,.6);
    transition:background .25s ease,box-shadow .25s ease,width .25s ease,height .25s ease}
  .n .tag{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;font-size:8px;font-weight:700;letter-spacing:.1em;
    text-transform:uppercase;color:var(--paper);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    background:linear-gradient(to top,rgba(0,0,0,.85),rgba(0,0,0,0));opacity:0;transform:translateY(4px);
    transition:opacity .25s ease,transform .25s ease;pointer-events:none}
  .n:hover img,.n.press img{filter:grayscale(0%) contrast(1.05) brightness(1);transform:scale(1.06)}
  .n:hover .f::after,.n.press .f::after{width:7px;height:7px;background:var(--alert);
    box-shadow:0 0 0 3px rgba(10,10,11,.65),0 0 10px rgba(255,59,31,1),0 0 22px rgba(255,59,31,.55)}
  .n:hover .tag,.n.press .tag{opacity:1;transform:translateY(0)}
  /* blend paintings: gold frame, gold core dot, a tag that always shows */
  .n.painting .f{box-shadow:0 0 0 2px var(--gold),0 0 18px rgba(232,196,122,.35)}
  .n.painting img{filter:none}
  .n.painting .f::after{background:var(--gold);box-shadow:0 0 0 3px rgba(10,10,11,.65),0 0 8px var(--gold),0 0 20px rgba(232,196,122,.7)}
  .n.painting .tag{opacity:1;transform:none;color:var(--gold)}
  .n.arrive .f{animation:flare 1.6s ease-out 1.1s 2}
  @keyframes flare{0%{box-shadow:0 0 0 2px var(--gold),0 0 0 0 rgba(232,196,122,.9)}
    100%{box-shadow:0 0 0 2px var(--gold),0 0 0 26px rgba(232,196,122,0)}}
  .n.glow .f{animation:pulse 1.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
  .n.dim{opacity:.35}
  #emblem{position:absolute;top:0;left:0;transform-style:preserve-3d;pointer-events:none;white-space:nowrap;
    color:var(--paper);font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;opacity:.9;
    text-shadow:0 1px 0 rgba(0,0,0,.35),0 4px 10px rgba(0,0,0,.6);transition:opacity .6s ease}
  #atmo{position:fixed;inset:0;pointer-events:none;z-index:5;
    background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(0,0,0,.45) 100%),
      repeating-linear-gradient(to bottom,rgba(255,255,255,.025) 0,rgba(255,255,255,.025) 1px,transparent 1px,transparent 3px)}
</style></head><body><div id="stage"><div id="world"><div id="emblem"></div></div></div><div id="atmo"></div>
<script>
(function(){
  var stage=document.getElementById('stage'), world=document.getElementById('world'), emblem=document.getElementById('emblem');
  var tiles=[], R=140, base=60, N=0, folded=false, built=false;
  var rotX=-8, rotY=0, rotZ=0, velX=0, velY=0, AUTO=0.12, FRICTION=0.945, VEL_MAX=5;
  var dragging=false, moved=0, lastX=0, lastY=0, downAt=0, downNode=null, spinBoost=0, focus=null;
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function rnd(i,a,b){ var s=Math.sin(i*a)*b; return s-Math.floor(s); }   // deterministic 0..1 per index

  // even spread for any N (golden-angle spiral), as lat/lon
  function fib(i,n){
    if(n<=1) return {lat:0,lon:0};
    var y=1-(i/(n-1))*2, r=Math.sqrt(Math.max(0,1-y*y)), th=i*Math.PI*(3-Math.sqrt(5));
    return {lat:Math.asin(y), lon:Math.atan2(Math.cos(th)*r, Math.sin(th)*r)};
  }
  function xyz(lat,lon,r){ return [r*Math.cos(lat)*Math.sin(lon), r*Math.sin(lat), r*Math.cos(lat)*Math.cos(lon)]; }

  function measure(){
    var w=window.innerWidth,h=window.innerHeight,n=Math.max(N,1);
    R=Math.min(w,h)*0.36;
    base=Math.max(30,Math.min(150,R*0.62,R*Math.sqrt(4*Math.PI/n)*0.62));
    AUTO=Math.max(0.05,0.14/Math.sqrt(Math.sqrt(n/14)));
  }
  // true aspect ratio at a constant footprint (area), so portraits and landscapes both read
  function sizeTile(t){
    var s=base*t.scale, a=t.aspect||1, w=Math.round(Math.sqrt(s*s*a)), h=Math.round(Math.sqrt(s*s/a));
    t.el.style.width=w+'px'; t.el.style.height=h+'px'; t.el.style.marginLeft=(-w/2)+'px'; t.el.style.marginTop=(-h/2)+'px';
  }
  function place(t,z,scale){
    t.el.style.transform='rotateY('+t.lon+'rad) rotateX('+(-t.lat)+'rad) translateZ('+z+'px) scale('+(scale||1)+')';
  }
  function home(t){ place(t,folded?0:R*t.depth,folded?0.15:1); }

  function makeTile(d,key,i){
    var el=document.createElement('div');
    el.className='n'+(d.kind==='painting'?' painting':'');
    el.innerHTML='<div class="f"><img draggable="false" decoding="async"></div><div class="tag"></div>';
    var t={el:el,key:key,id:d.id,kind:d.kind,tint:d.tint,aspect:1,scale:1,depth:1,lat:0,lon:0};
    var img=el.querySelector('img');
    img.onload=function(){ if(img.naturalWidth&&img.naturalHeight){ t.aspect=Math.max(0.55,Math.min(1.8,img.naturalWidth/img.naturalHeight)); sizeTile(t); } };
    img.src=d.img;
    el.querySelector('.tag').textContent=d.kind==='painting'?(d.label||'Blend'):(d.label||'File '+String(i+1).padStart(2,'0'));
    if(d.tint&&d.kind!=='painting'){
      el.querySelector('.f').style.boxShadow='0 0 0 2px '+d.tint+(d.tint2?',0 0 0 4px '+d.tint2:'');
    }
    el.dataset.id=d.id;
    world.appendChild(el);
    return t;
  }

  // rotate the world so a tile faces the camera (accounts for the current roll)
  function focusOn(t){
    var p=xyz(t.lat,t.lon,1), z=rotZ*Math.PI/180;
    // the node transform puts +lat at +y (CSS y is down), matching xyz()
    var v=[p[0]*Math.cos(z)-p[1]*Math.sin(z), p[0]*Math.sin(z)+p[1]*Math.cos(z), p[2]];
    var h=Math.hypot(v[0],v[2]), ry=Math.atan2(-v[0],v[2])*180/Math.PI, rx=Math.atan2(v[1],h)*180/Math.PI;
    var d=((ry-rotY)%360+540)%360-180;
    focus={t0:performance.now(),dur:1500,fx:rotX,fy:rotY,tx:Math.max(-70,Math.min(70,rx)),ty:rotY+d};
    velX=velY=0;
  }

  window.G={
    setTiles:function(list,opts){
      opts=opts||{};
      // small galleries repeat around the globe so the sphere reads as a sphere
      var full=list.slice();
      if(opts.fill!==false&&list.length&&list.length<36){ full=[]; for(var k=0;k<36;k++) full.push(list[k%list.length]); }
      var seen={}, keys=full.map(function(d){ seen[d.id]=(seen[d.id]||0)+1; return d.id+'#'+seen[d.id]; });
      var old={}; tiles.forEach(function(t){ old[t.key]=t; });
      var first=!built, fresh=[], next=[]; built=true;
      full.forEach(function(d,i){
        var t=old[keys[i]];
        if(t){ delete old[keys[i]]; } else { t=makeTile(d,keys[i],i); fresh.push(t); }
        next.push(t);
      });
      Object.keys(old).forEach(function(k){ var t=old[k]; t.el.style.opacity='0'; place(t,0,0.1); setTimeout(function(){ t.el.remove(); },1000); });
      tiles=next; N=tiles.length; measure();
      tiles.forEach(function(t,i){
        var p=fib(i,N); t.lat=p.lat; t.lon=p.lon;
        t.scale=0.8+rnd(i,12.9898,43758.5453)*0.45; t.depth=0.9+rnd(i,78.233,12543.112)*0.18;
        if(t.kind==='painting'&&opts.fill!==false) t.scale=Math.max(t.scale,1.15);
        sizeTile(t);
      });
      // new tiles start collapsed at the core, then fly to their slot
      fresh.forEach(function(t){ t.el.style.transition='none'; t.el.style.opacity='0'; place(t,0,0.1); });
      // the landing tile: an explicit arrive id, else (after the first build) the first new painting
      var land=opts.arrive?fresh.find(function(t){ return t.id===opts.arrive; }):null;
      if(!land&&!first) land=fresh.find(function(t){ return t.kind==='painting'; });
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        fresh.forEach(function(t){ if(t===land) return; t.el.style.transition=''; t.el.style.opacity=''; });
        tiles.forEach(function(t){ if(t!==land) home(t); });
        if(land){
          // on a first build, let the rest of the sphere settle before the new painting lands
          setTimeout(function(){
            land.el.style.transition=''; land.el.style.opacity=''; home(land);
            land.el.classList.add('arrive'); setTimeout(function(){ land.el.classList.remove('arrive'); },5000);
            focusOn(land);
          }, first?900:0);
        }
      });});
    },
    glowPairs:function(pairs){
      var used={};
      pairs.forEach(function(p){
        var a=tiles.find(function(t){ return t.id===p[0]&&!used[t.key]; });
        if(!a) return; used[a.key]=1;
        var b=tiles.find(function(t){ return t.id===p[1]&&!used[t.key]; });
        if(!b){ a.el.classList.add('glow'); return; }
        used[b.key]=1;
        var mlon=Math.atan2(Math.sin(a.lon)+Math.sin(b.lon),Math.cos(a.lon)+Math.cos(b.lon)), mlat=(a.lat+b.lat)/2;
        [a,b].forEach(function(t,k){
          t.lon=mlon+(k?0.3:-0.3); t.lat=mlat; t.el.classList.add('glow');
          t.el.querySelector('.f').style.boxShadow='0 0 0 2px '+(t.tint||'#E8C47A')+',0 0 26px 6px '+(t.tint||'#E8C47A');
          place(t,R*1.12,1.2);
        });
      });
      tiles.forEach(function(t){ if(!used[t.key]) t.el.classList.add('dim'); });
      var f=tiles.find(function(t){ return used[t.key]; }); if(f) focusOn(f);
    },
    fold:function(){
      folded=true; spinBoost=2.5; emblem.style.opacity='0';
      tiles.forEach(function(t){ t.el.classList.remove('dim'); t.el.style.opacity='0'; home(t); });
    },
    unfold:function(){ folded=false; spinBoost=0; emblem.style.opacity='.9'; tiles.forEach(function(t){ t.el.style.opacity=''; home(t); }); },
    setEmblem:function(text){ emblem.textContent=text||''; }
  };

  function render(){
    world.style.transform='rotateX('+rotX+'deg) rotateY('+rotY+'deg) rotateZ('+rotZ+'deg)';
    emblem.style.transform='translate(-50%,-50%) rotateZ('+(-rotZ)+'deg) rotateY('+(-rotY)+'deg) rotateX('+(-rotX)+'deg)';
  }
  function tick(now){
    if(focus&&!dragging){
      var k=Math.min(1,(now-focus.t0)/focus.dur), e=1-Math.pow(1-k,3);
      rotX=focus.fx+(focus.tx-focus.fx)*e; rotY=focus.fy+(focus.ty-focus.fy)*e;
      if(k>=1) focus=null;
    } else if(!dragging){
      // momentum rides on top of the steady spin and eases back into it
      rotY+=AUTO+velY+spinBoost; rotX+=velX; rotZ+=AUTO*0.62;
      rotX=Math.max(-70,Math.min(70,rotX));
      velX*=FRICTION; velY*=FRICTION;
      if(Math.abs(velX)<0.002) velX=0; if(Math.abs(velY)<0.002) velY=0;
    }
    render();
    requestAnimationFrame(tick);
  }

  function pt(e){ return e.touches?e.touches[0]:e; }
  var lastTouch=0;   // phones fire emulated mouse events after a touch; ignore those
  function down(e){
    if(e.touches) lastTouch=Date.now(); else if(Date.now()-lastTouch<800) return;
    var p=pt(e); dragging=true; moved=0; focus=null; velX=velY=0; lastX=p.clientX; lastY=p.clientY; downAt=Date.now();
    stage.classList.add('grabbing');
    downNode=e.target.closest?e.target.closest('.n'):null; if(downNode) downNode.classList.add('press');
  }
  function move(e){
    if(!dragging) return;
    var p=pt(e), dx=p.clientX-lastX, dy=p.clientY-lastY; lastX=p.clientX; lastY=p.clientY; moved+=Math.abs(dx)+Math.abs(dy);
    if(moved>8&&downNode){ downNode.classList.remove('press'); }
    var sy=dx*0.25, sx=-dy*0.25;
    rotY+=sy; rotX=Math.max(-70,Math.min(70,rotX+sx));
    velY=velY*0.7+sy*0.3; velX=velX*0.7+sx*0.3;     // smoothed drag speed becomes release momentum
    if(e.cancelable) e.preventDefault();
  }
  function up(){
    if(!dragging) return; dragging=false; stage.classList.remove('grabbing');
    velX=Math.max(-VEL_MAX,Math.min(VEL_MAX,velX)); velY=Math.max(-VEL_MAX,Math.min(VEL_MAX,velY));
    if(downNode){
      var n=downNode; setTimeout(function(){ n.classList.remove('press'); },350);
      if(moved<8&&Date.now()-downAt<400){ velX=velY=0; post({type:'tap',id:n.dataset.id}); }
    }
    downNode=null;
  }
  document.addEventListener('touchstart',down,{passive:true});
  document.addEventListener('touchmove',move,{passive:false});
  document.addEventListener('touchend',up);
  document.addEventListener('mousedown',down); document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
  window.addEventListener('resize',function(){ measure(); tiles.forEach(function(t){ sizeTile(t); home(t); }); });
  requestAnimationFrame(tick);
  post({type:'ready'});
})();
</script></body></html>`;
