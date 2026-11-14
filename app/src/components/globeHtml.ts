/**
 * The globe gallery (M4): a drag-to-explore sphere of rounded image tiles, rendered with CSS 3D
 * transforms inside a WebView. Tiles sit on a Fibonacci sphere; drag rotates with inertia and it
 * idles with a slow spin. Back-facing tiles are culled by the browser (backface-visibility).
 *
 * Commands from React Native (injectJavaScript):
 *   G.setTiles([{id, img, tint, tint2?, kind}])   rebuild the sphere
 *   G.glowPairs([[idA, idB], ...])                  matched pairs pull together and glow
 *   G.fold()                                        tiles fold into the center
 *   G.unfold()
 * Messages to React Native: {type:"tap", id}, {type:"ready"}
 */
export const GLOBE_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;touch-action:none}
  #stage{position:absolute;inset:0;perspective:900px;perspective-origin:50% 50%}
  #sphere{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d}
  .t{position:absolute;border-radius:14px;background-size:cover;background-position:center;background-color:#2a2622;
     backface-visibility:hidden;-webkit-backface-visibility:hidden;box-sizing:border-box;
     transition:transform 1.3s cubic-bezier(.2,.8,.2,1),opacity 1.1s ease,box-shadow .6s ease,filter .6s ease;
     box-shadow:0 2px 10px rgba(0,0,0,.45)}
  .t.painting{border:3px solid #E8C47A}
  .t.glow{animation:pulse 1.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
  .t.dim{filter:brightness(.45) saturate(.6)}
</style></head><body><div id="stage"><div id="sphere"></div></div>
<script>
(function(){
  var sphere=document.getElementById('sphere');
  var tiles=[], R=140, size=60, rx=-12, ry=0, vx=0, vy=0.12, dragging=false, lastX=0, lastY=0, moved=0, downAt=0, downId=null;
  var spinBoost=0;
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function layout(){
    var w=window.innerWidth,h=window.innerHeight,n=Math.max(tiles.length,1);
    R=Math.min(w,h)*0.40;
    size=Math.max(34,Math.min(110,R*Math.sqrt(4*Math.PI/n)*0.78));
  }
  function place(t,i,n,lon,lat,z,scale){
    var tf='rotateY('+lon+'rad) rotateX('+(-lat)+'rad) translateZ('+z+'px) scale('+(scale||1)+')';
    t.el.style.transform='translate(-50%,-50%) '+tf;
  }
  function fib(i,n){
    var y=1-2*(i+0.5)/n, r=Math.sqrt(1-y*y), phi=i*Math.PI*(3-Math.sqrt(5));
    return {lon:Math.atan2(Math.cos(phi)*r, Math.sin(phi)*r), lat:Math.asin(y)};
  }
  window.G={
    setTiles:function(list){
      sphere.innerHTML=''; tiles=[]; layout();
      list.forEach(function(d,i){
        var el=document.createElement('div');
        el.className='t'+(d.kind==='painting'?' painting':'');
        el.style.width=size+'px'; el.style.height=size+'px';
        el.style.backgroundImage='url("'+d.img+'")';
        if(d.tint && d.kind!=='painting'){
          el.style.border='3px solid '+d.tint;
          if(d.tint2) el.style.borderImage='linear-gradient(135deg,'+d.tint+','+d.tint2+') 1';
          if(d.tint2) el.style.borderRadius='4px';
        }
        el.dataset.id=d.id;
        sphere.appendChild(el);
        var p=fib(i,list.length);
        var t={el:el,id:d.id,lon:p.lon,lat:p.lat,tint:d.tint};
        tiles.push(t); place(t,i,list.length,p.lon,p.lat,R,0.2); el.style.opacity='0';
      });
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        tiles.forEach(function(t,i){ t.el.style.opacity='1'; place(t,i,tiles.length,t.lon,t.lat,R,1); });
      });});
    },
    glowPairs:function(pairs){
      var inPair={};
      pairs.forEach(function(p){
        var a=tiles.find(function(t){return t.id===p[0]}), b=tiles.find(function(t){return t.id===p[1]&&t!==a});
        if(!a) return;
        inPair[a.id]=1;
        if(!b){ a.el.classList.add('glow'); a.el.style.boxShadow='0 0 26px 6px #E8C47A'; return; }
        inPair[b.id]=1;
        var mlon=Math.atan2(Math.sin(a.lon)+Math.sin(b.lon),Math.cos(a.lon)+Math.cos(b.lon)), mlat=(a.lat+b.lat)/2;
        [a,b].forEach(function(t,k){
          t.lon=mlon+(k?0.16:-0.16); t.lat=mlat;
          t.el.classList.add('glow');
          t.el.style.boxShadow='0 0 26px 6px '+(t.tint||'#E8C47A');
          place(t,0,0,t.lon,t.lat,R*1.08,1.25);
        });
      });
      tiles.forEach(function(t){ if(!inPair[t.id]) t.el.classList.add('dim'); });
      if(pairs.length){ var f=tiles.find(function(t){return t.id===pairs[0][0]}); if(f){ ry=-f.lon*180/Math.PI; rx=f.lat*180/Math.PI*0.6; vy=0.04; } }
    },
    fold:function(){
      spinBoost=2.5;
      tiles.forEach(function(t,i){ t.el.classList.remove('dim'); t.el.style.opacity='0'; place(t,i,0,t.lon,t.lat,0,0.15); });
    },
    unfold:function(){ spinBoost=0; tiles.forEach(function(t,i){ t.el.style.opacity='1'; place(t,i,0,t.lon,t.lat,R,1); }); }
  };
  function frame(){
    if(!dragging){
      ry+=vy+spinBoost; rx+=vx;
      vy=vy*0.95+0.12*0.05; vx*=0.93;
      rx=Math.max(-70,Math.min(70,rx));
    }
    sphere.style.transform='rotateX('+rx+'deg) rotateY('+ry+'deg)';
    requestAnimationFrame(frame);
  }
  function pt(e){ return e.touches?e.touches[0]:e; }
  function down(e){ var p=pt(e); dragging=true; lastX=p.clientX; lastY=p.clientY; moved=0; downAt=Date.now();
    var el=e.target.closest&&e.target.closest('.t'); downId=el?el.dataset.id:null; }
  function move(e){ if(!dragging) return; var p=pt(e), dx=p.clientX-lastX, dy=p.clientY-lastY;
    lastX=p.clientX; lastY=p.clientY; moved+=Math.abs(dx)+Math.abs(dy);
    vy=dx*0.35; vx=-dy*0.35; ry+=vy; rx=Math.max(-70,Math.min(70,rx+vx)); e.preventDefault(); }
  function up(){ if(!dragging) return; dragging=false;
    if(moved<8 && Date.now()-downAt<400 && downId){ vy=0; vx=0; post({type:'tap',id:downId}); } }
  document.addEventListener('touchstart',down,{passive:true});
  document.addEventListener('touchmove',move,{passive:false});
  document.addEventListener('touchend',up);
  document.addEventListener('mousedown',down); document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
  window.addEventListener('resize',function(){ var keep=tiles.map(function(t){return t}); layout();
    keep.forEach(function(t,i){ t.el.style.width=size+'px'; t.el.style.height=size+'px'; place(t,i,0,t.lon,t.lat,R,1); }); });
  requestAnimationFrame(frame);
  post({type:'ready'});
})();
</script></body></html>`;
