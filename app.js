/* ============================================================
   ระบบติดตามเครื่องวัด DO — ตรรกะหลัก
   - แผนที่ OpenStreetMap (Leaflet) + รอ Google Key
   - นำทางในหน้านี้ด้วย OSRM (ไม่เด้งออก)
   - เพิ่ม/แก้หมุดได้
   - ซิงค์ข้ามเครื่องด้วย Firebase (ออฟไลน์ได้) / ถ้าไม่ตั้งค่า = โหมดเดโมเก็บในเครื่อง
   ============================================================ */

const CFG = window.APP_CONFIG || {};
const FB  = window.FIREBASE_CONFIG || {};
const useFirebase = !!(FB.apiKey && !String(FB.apiKey).includes('PASTE'));

/* ---------- ข้อมูลตัวอย่าง (โหมดเดโม) ---------- */
const SAMPLE_DATA = [
  { name:"ฟาร์มกุ้งบางปะกง 1", location:"บางปะกง ฉะเชิงเทรา", lat:13.5421, lng:100.9912, status:"online",  do_value:"5.8", do_updated:"2026-06-19 08:30", contact:"คุณสมชาย 081-234-5678", install_date:"2025-11-01", photo:"", note:"บ่อ A ระบบให้อากาศปกติ" },
  { name:"ฟาร์มปลานิลแปดริ้ว", location:"เมือง ฉะเชิงเทรา",   lat:13.6904, lng:101.0779, status:"online",  do_value:"6.4", do_updated:"2026-06-19 08:45", contact:"คุณวิไล 089-111-2222",  install_date:"2025-12-15", photo:"", note:"บ่อดิน 4 ไร่" },
  { name:"ฟาร์มกุ้งระยอง",      location:"บ้านฉาง ระยอง",      lat:12.7264, lng:101.0640, status:"offline", do_value:"3.1", do_updated:"2026-06-18 22:10", contact:"คุณอนุชา 082-555-7788", install_date:"2025-10-05", photo:"", note:"⚠ ค่า DO ต่ำ ตรวจเครื่องเติมอากาศ" },
  { name:"ฟาร์มหอยนางรมชลบุรี", location:"ศรีราชา ชลบุรี",     lat:13.1740, lng:100.9300, status:"online",  do_value:"7.0", do_updated:"2026-06-19 09:00", contact:"คุณมานี 086-333-4444",  install_date:"2026-01-20", photo:"", note:"" },
];

/* ---------- ฟังก์ชันช่วย ---------- */
const $ = (s)=>document.querySelector(s);
const esc = (s)=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toNum(v){ if(v===''||v==null) return null; const n=parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n)?null:n; }
// แปลงพิกัดช่องเดียว → {lat,lng} รองรับ "13.5, 100.9" และ "10.27284° N, 99.16552° E"
function parseLatLng(str){
  if(!str) return null;
  const s=String(str).trim();
  // แปลงพิกัด 1 ส่วน รองรับ DMS: "10°05'07.8\"N" → ทศนิยม
  function dec(part){
    const n=String(part).match(/-?\d+(?:\.\d+)?/g);
    if(!n || !n.length) return NaN;
    let v=Math.abs(parseFloat(n[0])) + (n[1]?parseFloat(n[1])/60:0) + (n[2]?parseFloat(n[2])/3600:0);
    if(parseFloat(n[0])<0 || /[SsWw]/.test(part)) v=-v;
    return v;
  }
  let latStr, lngStr;
  const mDir=s.match(/(.*?[NnSs])[ ,]+(.*?[EeWw])/);   // มีทิศ N/S ... E/W (รองรับ DMS)
  if(mDir){ latStr=mDir[1]; lngStr=mDir[2]; }
  else if(s.includes(',')){ const p=s.split(','); latStr=p[0]; lngStr=p.slice(1).join(','); }
  else { const n=s.match(/-?\d+(?:\.\d+)?/g); if(n && n.length>=2){ latStr=n[0]; lngStr=n[1]; } else return null; }
  const lat=dec(latStr), lng=dec(lngStr);
  if(isNaN(lat)||isNaN(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return null;
  return {lat,lng};
}
function computeStatus(r){
  const s=String(r.status||"").trim().toLowerCase();
  if(["online","on","1","true"].includes(s)) return "online";
  if(["offline","off","0","false"].includes(s)) return "offline";
  if((CFG.offlineThresholdMinutes>0) && r.do_updated){
    const t=new Date(String(r.do_updated).replace(" ","T"));
    if(!isNaN(t)) return ((Date.now()-t.getTime())/60000) <= CFG.offlineThresholdMinutes ? "online":"offline";
  }
  return "offline";
}
// สถานะหมุด: ถ้าผูก Sheet ใช้เวลาล่าสุดจาก Sheet (เก่ากว่า N นาที = ออฟไลน์), ไม่งั้นใช้ค่าที่กรอกเอง
function stationStatus(st){
  if(st.sheet && liveTimes[st.id]){
    return (Date.now()-liveTimes[st.id])/60000 <= (CFG.sheetOfflineMinutes||20) ? 'online' : 'offline';
  }
  return computeStatus(st);
}
function haversine(a,b,c,d){const R=6371,r=Math.PI/180,dLat=(c-a)*r,dLon=(d-b)*r;const x=Math.sin(dLat/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function fmtDist(km){ if(km==null) return ""; return km<1 ? Math.round(km*1000)+" ม." : km.toFixed(1)+" กม."; }
function nowStr(){ const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

/* ============================================================
   แผนที่
   ============================================================ */
const map = L.map('map',{zoomControl:true}).setView(CFG.mapCenter||[13.5,101], CFG.mapZoom||7);

// เลเยอร์ฐาน: แผนที่ปกติ (OSM) และ ดาวเทียม+ป้ายชื่อ (Esri imagery + labels/roads)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'});
const satLayer = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'ภาพดาวเทียม &copy; Esri'}),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
]);
let currentBase=null;
function setBase(which){
  const next = which==='sat' ? satLayer : osmLayer;
  if(currentBase===next) return;
  if(currentBase) map.removeLayer(currentBase);
  next.addTo(map); currentBase=next;
  document.querySelectorAll('#layerToggle button').forEach(b=>b.classList.toggle('active', b.dataset.layer===which));
}
setBase('map');
$('#layerToggle').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b) setBase(b.dataset.layer); });

function pinIcon(status){
  const color = status==='online' ? '#16a34a' : '#94a3b8';
  return L.divIcon({ className:'', iconSize:[30,42], iconAnchor:[15,42], popupAnchor:[0,-38],
    html:`<div class="pin ${status}"><span class="ring"></span>
      <svg viewBox="0 0 30 42" width="30" height="42">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
        <circle cx="15" cy="15" r="6" fill="#fff"/></svg></div>` });
}

/* ============================================================
   สถานะแอป
   ============================================================ */
let STATIONS=[];                 // ข้อมูลที่ใช้แสดง (มี _status, _dist, lat, lng)
let userLoc=null, userMarker=null;
let activeFilter='all', searchText='';
let firstFit=true, lastMeta=null;
const markerLayer = L.layerGroup().addTo(map);
const markersById = {};
const liveTimes = {};            // id -> เวลาล่าสุดจาก Sheet (ms) สำหรับเช็คออนไลน์/ออฟไลน์
let statusTimer = null;

/* ============================================================
   STORE — สลับระหว่าง Firebase / เก็บในเครื่อง
   ============================================================ */
function makeLocalStore(){
  const KEY='do_stations_v1';
  const safeGet=()=>{ try{ return localStorage.getItem(KEY); }catch(e){ return null; } };
  const safeSet=(v)=>{ try{ localStorage.setItem(KEY,v); }catch(e){} };
  let list = JSON.parse(safeGet()||'null');
  if(!list){ list = SAMPLE_DATA.map((d,i)=>({id:'demo'+i,...d})); safeSet(JSON.stringify(list)); }
  let cb=()=>{};
  const persist=()=>safeSet(JSON.stringify(list));
  const emit=()=>cb(list.slice(),{mode:'local',online:navigator.onLine,pending:0});
  return {
    mode:'local',
    subscribe(fn){ cb=fn; emit(); },
    save(s){
      if(s.id){ const i=list.findIndex(x=>x.id===s.id); if(i>=0) list[i]={...list[i],...s}; else list.push(s); }
      else { s.id='loc'+Date.now(); list.push(s); }
      persist(); emit();
    },
    remove(id){ list=list.filter(x=>x.id!==id); persist(); emit(); }
  };
}

async function makeFirebaseStore(){
  const [{ initializeApp }, fs] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js"),
  ]);
  const app = initializeApp(FB);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
  const col = fs.collection(db,'stations');
  let cb=()=>{};
  return {
    mode:'firebase',
    subscribe(fn){
      cb=fn;
      fs.onSnapshot(col,{includeMetadataChanges:true},(snap)=>{
        let pending=0; const list=[];
        snap.forEach(d=>{ const v=d.data(); if(v.deleted) return; if(d.metadata.hasPendingWrites) pending++; list.push({id:d.id,...v}); });
        cb(list,{mode:'firebase',online:navigator.onLine,pending,fromCache:snap.metadata.fromCache});
      },(err)=>{ console.error('Firestore error',err); });
    },
    save(s){
      const data={...s}; delete data.id;
      data.updatedAt = fs.serverTimestamp(); data.deleted = false;
      const ref = s.id ? fs.doc(db,'stations',s.id) : fs.doc(col);
      // ไม่ await — ให้ขึ้นจอทันทีจาก cache แล้วซิงค์เองทีหลัง
      fs.setDoc(ref,data,{merge:true}).catch(e=>console.warn('จะซิงค์ภายหลัง',e));
    },
    remove(id){
      fs.setDoc(fs.doc(db,'stations',id),{deleted:true,updatedAt:fs.serverTimestamp()},{merge:true}).catch(e=>console.warn(e));
    }
  };
}

let store=null;
async function initStore(){
  if(useFirebase){
    try{ store = await makeFirebaseStore(); }
    catch(e){ console.error('ต่อ Firebase ไม่ได้ ใช้โหมดเครื่องแทน',e); store = makeLocalStore(); $('#demoBanner').style.display='block'; }
  } else {
    store = makeLocalStore();
    $('#demoBanner').style.display='block';
  }
  store.subscribe(onData);
}

/* ============================================================
   เมื่อข้อมูลเปลี่ยน
   ============================================================ */
function onData(list, meta){
  lastMeta=meta;
  STATIONS = list.map(d=>({ ...d, lat:toNum(d.lat), lng:toNum(d.lng), _dist:null }))
                 .filter(d=>d.lat!=null && d.lng!=null && Math.abs(d.lat)<=90 && Math.abs(d.lng)<=180);
  STATIONS.forEach(st=>{ st._status=stationStatus(st); });
  if(userLoc) recomputeDistances();
  renderMarkers(); renderList(); updateStats(); renderSync(meta);
  if(firstFit && STATIONS.length){ fitAll(); firstFit=false; }
  if(!statusTimer && STATIONS.some(s=>s.sheet)){ refreshStatuses(); statusTimer=setInterval(refreshStatuses, 120000); }
}

function recomputeDistances(){ STATIONS.forEach(s=>{ s._dist = userLoc ? haversine(userLoc[0],userLoc[1],s.lat,s.lng) : null; }); }
function fitAll(){ const pts=STATIONS.map(s=>[s.lat,s.lng]); if(userLoc) pts.push(userLoc); if(pts.length) map.fitBounds(pts,{padding:[60,60],maxZoom:13}); }
function fitVisible(){ const pts=visibleStations().map(s=>[s.lat,s.lng]); if(pts.length) map.fitBounds(pts,{padding:[70,70],maxZoom:14}); }

/* ---------- หมุด ---------- */
function buildPopup(st){
  const online=st._status==='online';
  const photo = st.photo ? `<div class="pp-photo" style="background-image:url('${esc(st.photo)}')"></div>`:'';
  const dist = st._dist!=null ? `<div class="pp-dist">📏 ห่างจากคุณ ~${fmtDist(st._dist)}</div>`:'';
  let doBlock;
  if(st.sheet){
    doBlock = `<div class="pp-live" id="live-${st.id}"></div>`;
  } else {
    const doVal=(st.do_value!=null && st.do_value!=='') ? `${esc(st.do_value)} <small>mg/L</small>` : '<small>—</small>';
    doBlock = `<div class="pp-row"><span>ค่า DO ล่าสุด</span><b class="pp-do">${doVal}</b></div>`
            + (st.do_updated ? `<div class="pp-row"><span>อัปเดตเมื่อ</span><b>${esc(st.do_updated)}</b></div>` : '');
  }
  const rows=[];
  if(st.install_date)  rows.push(`<div class="pp-row"><span>วันที่ติดตั้ง</span><b>${esc(st.install_date)}</b></div>`);
  if(st.contact)       rows.push(`<div class="pp-row"><span>ติดต่อ</span><b>${esc(st.contact)}</b></div>`);
  if(st.note)          rows.push(`<div class="pp-row"><span>หมายเหตุ</span><b>${esc(st.note)}</b></div>`);
  return `<div>${photo}<div class="pp-body">
    <div class="pp-name">${esc(st.name||'(ไม่มีชื่อ)')}</div>
    <div class="pp-loc">📍 ${esc(st.location||'-')}</div>
    <span class="badge ${online?'online':'offline'}">${online?'● ออนไลน์':'● ออฟไลน์'}</span>
    ${doBlock}${rows.join('')}${dist}
    <div class="pp-actions">
      <button class="pp-btn pp-nav" onclick="DO.nav('${st.id}')">🧭 นำทาง</button>
      <button class="pp-btn pp-edit" onclick="DO.edit('${st.id}')" title="แก้ไข">✏️</button>
    </div></div></div>`;
}
function renderMarkers(){
  markerLayer.clearLayers();
  for(const k in markersById) delete markersById[k];
  visibleStations().forEach(st=>{
    const m=L.marker([st.lat,st.lng],{icon:pinIcon(st._status)}).bindPopup(()=>buildPopup(st));
    m.bindTooltip(esc(st.name||'(ไม่มีชื่อ)'),{permanent:true,direction:'top',offset:[0,-40],className:'pin-label'});
    if(st.sheet) m.on('popupopen',()=>loadLive(st));
    markerLayer.addLayer(m); markersById[st.id]=m;
  });
}

/* ---------- รายการด้านข้าง ---------- */
function visibleStations(){
  let list=STATIONS.filter(st=>{
    if(activeFilter!=='all' && st._status!==activeFilter) return false;
    if(searchText){ const t=((st.name||'')+' '+(st.location||'')).toLowerCase(); if(!t.includes(searchText)) return false; }
    return true;
  });
  if(userLoc) list=list.slice().sort((a,b)=>(a._dist??1e9)-(b._dist??1e9));
  return list;
}
function renderList(){
  const list=visibleStations(), box=$('#list');
  $('#listCount').textContent=`พบ ${list.length} จุด`;
  $('#sortNote').textContent=userLoc?'เรียงจากใกล้สุด':'';
  if(!list.length){ box.innerHTML='<div class="st-empty">ไม่พบเครื่องวัดที่ตรงเงื่อนไข<br>กด ➕ เพิ่มหมุด เพื่อเพิ่มจุดใหม่</div>'; return; }
  box.innerHTML=list.map(st=>{
    const sub=[st.location, (st.do_value?('DO '+st.do_value):'')].filter(Boolean).join(' · ');
    const dist=st._dist!=null?`<div class="st-dist">${fmtDist(st._dist)}</div>`:'';
    return `<div class="station" data-id="${st.id}">
      <div class="st-status ${st._status}"></div>
      <div class="st-main"><div class="st-name">${esc(st.name||'(ไม่มีชื่อ)')}</div><div class="st-sub">${esc(sub)}</div></div>
      <div class="st-right">${dist}<button class="st-nav" onclick="event.stopPropagation();DO.nav('${st.id}')">🧭 นำทาง</button></div>
    </div>`;
  }).join('');
}
function updateStats(){
  const on=STATIONS.filter(s=>s._status==='online').length;
  $('#stTotal').textContent=STATIONS.length; $('#stOnline').textContent=on; $('#stOffline').textContent=STATIONS.length-on;
}
function focusStation(id){
  const st=STATIONS.find(s=>s.id===id); if(!st) return;
  const z=Math.max(map.getZoom(),14);
  // ดัน center ขึ้น ~100px เพื่อให้หมุดอยู่ "ค่อนกลาง" + เหลือที่ด้านบนให้ popup ที่เด้งขึ้น เห็นเต็ม
  const center=map.unproject(map.project([st.lat,st.lng],z).subtract([0,100]),z);
  map.setView(center,z,{animate:true});
  setTimeout(()=>markersById[id]?.openPopup(), 320);
  document.querySelectorAll('.station').forEach(el=>el.classList.toggle('active', el.dataset.id===id));
}

/* ---------- สถานะซิงค์ ---------- */
function renderSync(meta){
  if(!meta) return;
  const chip=$('#syncChip'); const online=navigator.onLine;
  let dot='off',txt='';
  if(meta.mode==='local'){ dot='off'; txt='💾 เก็บในเครื่อง'; }
  else if(!online){ dot='off'; txt='⚪ ออฟไลน์'+(meta.pending?` · รอซิงค์ ${meta.pending}`:''); }
  else if(meta.pending){ dot='off'; txt=`🟡 กำลังซิงค์ ${meta.pending}`; }
  else { dot='on'; txt='🟢 ซิงค์แล้ว'; }
  chip.innerHTML=`<span class="dot ${dot}"></span> ${txt}`;
}
window.addEventListener('online', ()=>renderSync(lastMeta));
window.addEventListener('offline', ()=>renderSync(lastMeta));

/* ============================================================
   หาตำแหน่งฉัน
   ============================================================ */
function locateMe(after){
  const btn=$('#btnLoc');
  if(!navigator.geolocation){ alert('เบราว์เซอร์ไม่รองรับการหาตำแหน่ง'); return; }
  btn.disabled=true; btn.textContent='⏳ กำลังหา...';
  navigator.geolocation.getCurrentPosition(pos=>{
    userLoc=[pos.coords.latitude,pos.coords.longitude];
    if(userMarker) map.removeLayer(userMarker);
    userMarker=L.circleMarker(userLoc,{radius:8,color:'#fff',weight:2,fillColor:'#2563eb',fillOpacity:1}).addTo(map).bindPopup('📍 ตำแหน่งของคุณ');
    recomputeDistances(); renderList();
    btn.disabled=false; btn.textContent='📍 ตำแหน่งฉัน';
    if(typeof after==='function') after(); else fitAll();
  },err=>{
    btn.disabled=false; btn.textContent='📍 ตำแหน่งฉัน';
    alert('หาตำแหน่งไม่สำเร็จ: '+err.message+'\n(ต้องเปิดสิทธิ์ Location และเปิดผ่าน https)');
  },{enableHighAccuracy:true,timeout:10000});
}

/* ============================================================
   นำทาง (วาดเส้นทางในหน้านี้ด้วย OSRM)
   ============================================================ */
let routeControl=null;
function clearRoute(){ if(routeControl){ try{map.removeControl(routeControl);}catch(e){} routeControl=null; } $('#routeBanner').style.display='none'; const g=$('#routeGmap'); if(g) g.style.display='none'; }
function navigateTo(id){
  const st=STATIONS.find(s=>s.id===id); if(!st) return;
  map.closePopup();   // ปิดป๊อปอัปก่อน จะได้ไม่บังเส้นทาง
  if(!userLoc){ locateMe(()=>navigateTo(id)); return; }
  clearRoute();
  $('#routeBanner').style.display='flex';
  $('#routeText').textContent='กำลังหาเส้นทางไป '+(st.name||'จุดนี้')+'...';
  routeControl=L.Routing.control({
    waypoints:[L.latLng(userLoc[0],userLoc[1]), L.latLng(st.lat,st.lng)],
    router:L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1',profile:'driving'}),
    addWaypoints:false, draggableWaypoints:false, fitSelectedRoutes:true, show:false, routeWhileDragging:false,
    lineOptions:{styles:[{color:'#0ea5e9',weight:6,opacity:.85}]},
    createMarker:()=>null
  }).addTo(map);
  routeControl.on('routesfound',e=>{
    const r=e.routes[0];
    $('#routeText').innerHTML=`🚗 ไป <b>${esc(st.name||'จุดนี้')}</b> • ${(r.summary.totalDistance/1000).toFixed(1)} กม. • ~${Math.round(r.summary.totalTime/60)} นาที`;
    const g=$('#routeGmap');
    g.href=`https://www.google.com/maps/dir/?api=1&origin=${userLoc[0]},${userLoc[1]}&destination=${st.lat},${st.lng}&travelmode=driving`;
    g.style.display='inline-block';
  });
  routeControl.on('routingerror',()=>{ $('#routeText').textContent='หาเส้นทางไม่ได้ (ต้องมีเน็ต) ลองใหม่อีกครั้ง'; });
}
$('#routeCancel').addEventListener('click',clearRoute);

/* ============================================================
   เพิ่ม / แก้ไข หมุด
   ============================================================ */
const overlay=$('#overlay');
const FIELDS=['name','location','lat','lng','status','do_value','do_updated','contact','install_date','photo','note','sheet'];
function openModal(st){
  $('#modalTitle').textContent = st ? 'แก้ไขหมุด' : 'เพิ่มหมุดใหม่';
  $('#f_id').value = st?.id || '';
  FIELDS.forEach(f=>{ const el=$('#f_'+f); if(el) el.value = st?.[f] ?? ''; });
  $('#f_coord').value = (st && st.lat!=null && st.lng!=null) ? `${st.lat}, ${st.lng}` : '';
  $('#btnDelete').style.display = st ? 'block':'none';
  overlay.classList.add('show');
}
function closeModal(){ overlay.classList.remove('show'); }
function openEdit(id){ openModal(STATIONS.find(s=>s.id===id)); }

$('#btnSave').addEventListener('click',()=>{
  if(!$('#f_name').value.trim()){ alert('กรุณาใส่ชื่อฟาร์ม/จุดติดตั้ง'); return; }
  const ll=parseLatLng($('#f_coord').value);
  if(!ll){ alert('พิกัดไม่ถูกต้อง — วางแบบ "13.5421, 100.9912" หรือกดปักจุด/ใช้ GPS'); return; }
  const rec={id:$('#f_id').value||undefined};
  FIELDS.forEach(f=>{ const el=$('#f_'+f); if(el) rec[f]=el.value.trim(); });
  rec.lat=ll.lat; rec.lng=ll.lng;
  store.save(rec); closeModal();
});
$('#btnDelete').addEventListener('click',()=>{
  const id=$('#f_id').value;
  if(id && confirm('ลบหมุดนี้ออกจากระบบ?')){ store.remove(id); closeModal(); }
});
$('#btnCancel').addEventListener('click',closeModal);
$('#modalClose').addEventListener('click',closeModal);
$('#nowBtn').addEventListener('click',()=>{ $('#f_do_updated').value=nowStr(); });
$('#useGps').addEventListener('click',()=>{
  if(!navigator.geolocation){ alert('ไม่รองรับ GPS'); return; }
  $('#useGps').textContent='⏳...';
  navigator.geolocation.getCurrentPosition(p=>{
    $('#f_coord').value=p.coords.latitude.toFixed(6)+', '+p.coords.longitude.toFixed(6); $('#useGps').textContent='📍 ใช้ GPS ตอนนี้';
  },e=>{ alert('หาตำแหน่งไม่ได้: '+e.message); $('#useGps').textContent='📍 ใช้ GPS ตอนนี้'; },{enableHighAccuracy:true,timeout:10000});
});

/* ---------- ปักจุดบนแผนที่ + ค้นหาสถานที่ ---------- */
let pickMode=false, placeMarker=null, pickCoord=null;

function setPlaceMarker(ll, fly){
  pickCoord = Array.isArray(ll) ? {lat:ll[0], lng:ll[1]} : {lat:ll.lat, lng:ll.lng};
  if(!placeMarker){
    placeMarker = L.marker([pickCoord.lat,pickCoord.lng],{draggable:true,autoPan:true}).addTo(map);
    placeMarker.on('dragend',()=>{ const p=placeMarker.getLatLng(); pickCoord={lat:p.lat,lng:p.lng}; });
  } else {
    placeMarker.setLatLng([pickCoord.lat,pickCoord.lng]);
  }
  if(fly) map.flyTo([pickCoord.lat,pickCoord.lng], 16);
}
function enterPickMode(){
  pickMode=true; closeModal();
  $('#pickBar').style.display='flex';
  $('#placeSearch').value=''; hideResults();
  pickCoord=null; if(placeMarker){ map.removeLayer(placeMarker); placeMarker=null; }
  const ll=parseLatLng($('#f_coord').value);
  if(ll){ setPlaceMarker([ll.lat,ll.lng], false); map.setView([ll.lat,ll.lng], Math.max(map.getZoom(),15)); }
  setTimeout(()=>map.invalidateSize(),60);
}
function exitPickMode(){
  pickMode=false; $('#pickBar').style.display='none'; hideResults();
  if(placeMarker){ map.removeLayer(placeMarker); placeMarker=null; }
}
$('#pickMap').addEventListener('click', enterPickMode);
$('#pickConfirm').addEventListener('click',()=>{
  if(!pickCoord){ alert('ยังไม่ได้เลือกตำแหน่ง — แตะบนแผนที่ หรือค้นหาสถานที่ก่อนครับ'); return; }
  $('#f_coord').value=pickCoord.lat.toFixed(6)+', '+pickCoord.lng.toFixed(6);
  exitPickMode(); overlay.classList.add('show');
});
$('#pickCancel').addEventListener('click',()=>{ exitPickMode(); overlay.classList.add('show'); });
map.on('click',e=>{ if(pickMode){ hideResults(); setPlaceMarker(e.latlng,false); } });

/* ค้นหาสถานที่ด้วย Nominatim (ฟรี ไม่ต้องใช้ Key) */
const placeResults=$('#placeResults');
function hideResults(){ placeResults.classList.remove('show'); placeResults.innerHTML=''; }
let searchTimer=null;
$('#placeSearch').addEventListener('input',e=>{
  const q=e.target.value.trim();
  clearTimeout(searchTimer);
  if(q.length<3){ hideResults(); return; }
  searchTimer=setTimeout(()=>doPlaceSearch(q), 700);  // หน่วงตามกติกา Nominatim
});
function doPlaceSearch(q){
  placeResults.innerHTML='<div class="pres-empty">⏳ กำลังค้นหา...</div>'; placeResults.classList.add('show');
  const url='https://nominatim.openstreetmap.org/search?format=json&accept-language=th&countrycodes=th&limit=5&q='+encodeURIComponent(q);
  fetch(url,{headers:{'Accept':'application/json'}})
    .then(r=>r.json())
    .then(list=>{
      if(!Array.isArray(list)||!list.length){ placeResults.innerHTML='<div class="pres-empty">ไม่พบสถานที่ — ลองพิมพ์ ตำบล/อำเภอ/จังหวัด</div>'; return; }
      placeResults.innerHTML=list.map(r=>{
        const parts=String(r.display_name||'').split(',').map(s=>s.trim());
        return `<div class="pres" data-lat="${r.lat}" data-lng="${r.lon}">
          <div class="pres-main">${esc(parts.slice(0,2).join(', '))}</div>
          <div class="pres-sub">${esc(parts.slice(2).join(', '))}</div></div>`;
      }).join('');
    })
    .catch(()=>{ placeResults.innerHTML='<div class="pres-empty">ค้นหาไม่ได้ (ตรวจอินเทอร์เน็ต)</div>'; });
}
placeResults.addEventListener('click',e=>{
  const row=e.target.closest('.pres'); if(!row) return;
  setPlaceMarker([parseFloat(row.dataset.lat), parseFloat(row.dataset.lng)], true);
  $('#placeSearch').value=row.querySelector('.pres-main').textContent;
  hideResults();
});

/* ============================================================
   เชื่อมปุ่ม/อีเวนต์
   ============================================================ */
$('#list').addEventListener('click',e=>{ const row=e.target.closest('.station'); if(row) focusStation(row.dataset.id); });
$('#search').addEventListener('input',e=>{ searchText=e.target.value.trim().toLowerCase(); renderMarkers(); renderList(); });
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filters button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); activeFilter=b.dataset.f; renderMarkers(); renderList(); fitVisible();
}));
$('#btnLoc').addEventListener('click',()=>locateMe());
$('#btnAdd').addEventListener('click',()=>openModal(null));
$('#fabAdd').addEventListener('click',()=>openModal(null));

/* ============================================================
   📊 ดึงค่าล่าสุดจาก Google Sheet ของแต่ละบ่อ (ตอนกดหมุด)
   ============================================================ */
function extractSheetId(s){
  if(!s) return '';
  const m=String(s).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : String(s).trim().replace(/\s+/g,'');
}
function extractGid(s){ const m=String(s||'').match(/[?#&]gid=(\d+)/); return m ? m[1] : ''; }
const gvizCsvUrl  =(id,gid)=>`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`+(gid?`&gid=${gid}`:'');
const exportCsvUrl=(id,gid)=>`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`+(gid?`&gid=${gid}`:'');

function parseCSV(text){
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else {
      if(c==='"') q=true;
      else if(c===','){ row.push(cur); cur=''; }
      else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
      else if(c!=='\r') cur+=c;
    }
  }
  if(cur!=='' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

function loadLiveById(id){ const st=STATIONS.find(s=>s.id===id); if(st) loadLive(st); }

// โหลด CSV แบบเติม BOM (UTF-8) เพื่อให้ Excel อ่านภาษาไทยถูกต้อง ไม่เพี้ยน
async function downloadCsv(id){
  const st=STATIONS.find(s=>s.id===id); if(!st) return;
  const sid=extractSheetId(st.sheet), gid=extractGid(st.sheet);
  if(!sid) return;
  // ใช้ gviz (ตอบ 200 + CORS ตรงๆ) ไม่ใช้ export (เด้ง 307 → fetch พัง)
  const url=gid?gvizCsvUrl(sid,gid):gvizCsvUrl(sid);
  const btn=document.querySelector('#live-'+id+' .pp-live-dl');
  const old=btn?btn.textContent:''; if(btn){ btn.textContent='⏳ กำลังโหลด...'; }
  try{
    const text=await fetch(url,{cache:'no-store'}).then(r=>{ if(!r.ok) throw 0; return r.text(); });
    // ﻿ = BOM บอก Excel ว่าไฟล์นี้เป็น UTF-8 → ภาษาไทยไม่เพี้ยน
    const blob=new Blob(['﻿'+text],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a');
    const fname=(st.name?String(st.name).replace(/[\\/:*?"<>|]/g,'_'):'DO')+'_'+(new Date().toISOString().slice(0,10))+'.csv';
    a.href=URL.createObjectURL(blob); a.download=fname;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
    if(btn) btn.textContent=old;
  }catch(e){
    // ดึงผ่าน fetch ไม่ได้ (เช่น CORS) → เปิดลิงก์ตรงแทน
    if(btn) btn.textContent=old;
    window.open(url,'_blank','noopener');
  }
}

// ดึงแถวล่าสุดจาก Sheet (ลองหลายแท็บ: gid → DataLog → แท็บแรก) คืน {header,latest,tCol,doCol,dlUrl}
async function fetchLatest(st){
  const id=extractSheetId(st.sheet), gid=extractGid(st.sheet);
  if(!id) return null;
  const urls=[];
  if(gid) urls.push(gvizCsvUrl(id,gid));
  urls.push(gvizCsvUrl(id)+'&sheet=DataLog');
  urls.push(gvizCsvUrl(id));
  for(const url of urls){
    try{
      const text=await fetch(url,{cache:'no-store'}).then(r=>r.ok?r.text():'');
      const rows=parseCSV(text).filter(r=>r.length>1 && r.some(c=>String(c).trim()!==''));
      if(rows.length>=2){
        const header=rows[0].map(h=>h.trim()), data=rows.slice(1);
        let tCol=header.findIndex(h=>/วันที่|เวลา|date|time/i.test(h)); if(tCol<0) tCol=0;
        const doCol=header.findIndex(h=>/DO/i.test(h));
        let latest=data[0], best=-Infinity;
        for(const r of data){ const ts=Date.parse(String(r[tCol]||'').replace(' ','T')); if(!isNaN(ts)&&ts>best){best=ts;latest=r;} }
        return {header,latest,tCol,doCol,dlUrl:url};
      }
    }catch(e){}
  }
  return null;
}

async function loadLive(st){
  const box=document.getElementById('live-'+st.id);
  if(!box) return;
  if(!extractSheetId(st.sheet)){ box.innerHTML='<div class="pp-live-err">ลิงก์ Sheet ไม่ถูกต้อง</div>'; return; }
  box.innerHTML='<div class="pp-live-load">⏳ กำลังดึงค่าล่าสุดจาก Sheet...</div>';
  const r=await fetchLatest(st);
  if(!r){
    const id=extractSheetId(st.sheet), gid=extractGid(st.sheet);
    box.innerHTML='<div class="pp-live-err">อ่าน Sheet ไม่ได้ หรือยังไม่มีข้อมูล — ตรวจว่าแชร์ "ผู้ที่มีลิงก์ดูได้" · '
      +'<a href="'+(gid?exportCsvUrl(id,gid):exportCsvUrl(id))+'" target="_blank" rel="noopener">เปิด CSV</a></div>';
    return;
  }
  // อัปเดตสถานะ online/offline จากเวลาล่าสุด (อัปไอคอนหมุดเฉพาะตัว ไม่ rebuild ทั้งหมด เพื่อไม่ให้ popup ปิด)
  const ts=Date.parse(String(r.latest[r.tCol]||'').replace(' ','T'));
  if(!isNaN(ts)){ liveTimes[st.id]=ts; st._status=stationStatus(st); markersById[st.id]?.setIcon(pinIcon(st._status)); renderList(); updateStats(); }
  const fresh = !isNaN(ts) ? ((Date.now()-ts)/60000 <= (CFG.sheetOfflineMinutes||20)) : null;
  const badge = fresh===null ? '' : (fresh ? '<span class="live-on">● ออนไลน์</span>' : '<span class="live-off">● ออฟไลน์ (ข้อมูลเก่า)</span>');
  let grid='';
  r.header.forEach((h,i)=>{
    if(i===r.tCol || i===r.doCol) return;
    const v=String(r.latest[i]||'').trim(); if(!v) return;
    grid+=`<div><span>${esc(h)}</span><b>${esc(v)}</b></div>`;
  });
  box.innerHTML=
    `<div class="pp-live-head">📊 ค่าล่าสุดจาก Google Sheet ${badge}</div>
     <div class="pp-live-do">DO <b>${esc(r.doCol>=0?r.latest[r.doCol]:'—')}</b> <small>mg/L</small></div>
     <div class="pp-live-time">🕒 ${esc(r.latest[r.tCol]||'')}</div>
     <div class="pp-live-grid">${grid}</div>
     <div class="pp-live-actions">
       <button class="pp-live-refresh" onclick="DO.live('${st.id}')">🔄 รีเฟรช</button>
       <button class="pp-live-dl" onclick="DO.dl('${st.id}')">⬇️ ดาวน์โหลด CSV</button>
     </div>`;
}

// เช็คสถานะหมุดที่ผูก Sheet ทุกตัว (ดึงเวลาล่าสุด → เทียบ 20 นาที) เรียกตอนโหลด + ทุก ~2 นาที
async function refreshStatuses(){
  const list=STATIONS.filter(s=>s.sheet && extractSheetId(s.sheet));
  if(!list.length) return;
  await Promise.all(list.map(async st=>{
    const r=await fetchLatest(st);
    if(r){ const ts=Date.parse(String(r.latest[r.tCol]||'').replace(' ','T')); if(!isNaN(ts)) liveTimes[st.id]=ts; }
  }));
  STATIONS.forEach(st=>{ st._status=stationStatus(st); markersById[st.id]?.setIcon(pinIcon(st._status)); });
  renderList(); updateStats();
}

// เปิดให้ปุ่มใน popup/list เรียกได้
window.DO = { nav:navigateTo, edit:openEdit, focus:focusStation, live:loadLiveById, dl:downloadCsv };

/* ============================================================
   Service Worker (โหมดออฟไลน์) + เริ่มทำงาน
   ============================================================ */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW',e)));
}
initStore();
