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
function haversine(a,b,c,d){const R=6371,r=Math.PI/180,dLat=(c-a)*r,dLon=(d-b)*r;const x=Math.sin(dLat/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function fmtDist(km){ if(km==null) return ""; return km<1 ? Math.round(km*1000)+" ม." : km.toFixed(1)+" กม."; }
function nowStr(){ const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

/* ============================================================
   แผนที่
   ============================================================ */
const map = L.map('map',{zoomControl:true}).setView(CFG.mapCenter||[13.5,101], CFG.mapZoom||7);
function addOSM(){ L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map); }
(function baseLayer(){
  if(CFG.googleApiKey){
    const sc=document.createElement('script');
    sc.src=`https://maps.googleapis.com/maps/api/js?key=${CFG.googleApiKey}`;
    sc.onload=()=>{ try{ L.gridLayer.googleMutant({type:'roadmap'}).addTo(map);}catch(e){addOSM();} };
    sc.onerror=addOSM; document.head.appendChild(sc);
  } else addOSM();
})();

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
  STATIONS = list.map(d=>({ ...d, lat:toNum(d.lat), lng:toNum(d.lng), _status:computeStatus(d), _dist:null }))
                 .filter(d=>d.lat!=null && d.lng!=null);
  if(userLoc) recomputeDistances();
  renderMarkers(); renderList(); updateStats(); renderSync(meta);
  if(firstFit && STATIONS.length){ fitAll(); firstFit=false; }
}

function recomputeDistances(){ STATIONS.forEach(s=>{ s._dist = userLoc ? haversine(userLoc[0],userLoc[1],s.lat,s.lng) : null; }); }
function fitAll(){ const pts=STATIONS.map(s=>[s.lat,s.lng]); if(userLoc) pts.push(userLoc); if(pts.length) map.fitBounds(pts,{padding:[60,60],maxZoom:13}); }

/* ---------- หมุด ---------- */
function buildPopup(st){
  const online=st._status==='online';
  const photo = st.photo ? `<div class="pp-photo" style="background-image:url('${esc(st.photo)}')"></div>`:'';
  const doVal = (st.do_value!=null && st.do_value!=='') ? `${esc(st.do_value)} <small>mg/L</small>` : '<small>—</small>';
  const dist = st._dist!=null ? `<div class="pp-dist">📏 ห่างจากคุณ ~${fmtDist(st._dist)}</div>`:'';
  const rows=[`<div class="pp-row"><span>ค่า DO ล่าสุด</span><b class="pp-do">${doVal}</b></div>`];
  if(st.do_updated)    rows.push(`<div class="pp-row"><span>อัปเดตเมื่อ</span><b>${esc(st.do_updated)}</b></div>`);
  if(st.install_date)  rows.push(`<div class="pp-row"><span>วันที่ติดตั้ง</span><b>${esc(st.install_date)}</b></div>`);
  if(st.contact)       rows.push(`<div class="pp-row"><span>ติดต่อ</span><b>${esc(st.contact)}</b></div>`);
  if(st.note)          rows.push(`<div class="pp-row"><span>หมายเหตุ</span><b>${esc(st.note)}</b></div>`);
  return `<div>${photo}<div class="pp-body">
    <div class="pp-name">${esc(st.name||'(ไม่มีชื่อ)')}</div>
    <div class="pp-loc">📍 ${esc(st.location||'-')}</div>
    <span class="badge ${online?'online':'offline'}">${online?'● ออนไลน์':'● ออฟไลน์'}</span>
    ${rows.join('')}${dist}
    <div class="pp-actions">
      <button class="pp-btn pp-nav" onclick="DO.nav('${st.id}')">🧭 นำทาง</button>
      <button class="pp-btn pp-edit" onclick="DO.edit('${st.id}')" title="แก้ไข">✏️</button>
    </div></div></div>`;
}
function renderMarkers(){
  markerLayer.clearLayers();
  for(const k in markersById) delete markersById[k];
  STATIONS.forEach(st=>{
    const m=L.marker([st.lat,st.lng],{icon:pinIcon(st._status)}).bindPopup(()=>buildPopup(st));
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
  map.setView([st.lat,st.lng], Math.max(map.getZoom(),14),{animate:true});
  markersById[id]?.openPopup();
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
function clearRoute(){ if(routeControl){ try{map.removeControl(routeControl);}catch(e){} routeControl=null; } $('#routeBanner').style.display='none'; }
function navigateTo(id){
  const st=STATIONS.find(s=>s.id===id); if(!st) return;
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
  });
  routeControl.on('routingerror',()=>{ $('#routeText').textContent='หาเส้นทางไม่ได้ (ต้องมีเน็ต) ลองใหม่อีกครั้ง'; });
}
$('#routeCancel').addEventListener('click',clearRoute);

/* ============================================================
   เพิ่ม / แก้ไข หมุด
   ============================================================ */
const overlay=$('#overlay');
const FIELDS=['name','location','lat','lng','status','do_value','do_updated','contact','install_date','photo','note'];
function openModal(st){
  $('#modalTitle').textContent = st ? 'แก้ไขหมุด' : 'เพิ่มหมุดใหม่';
  $('#f_id').value = st?.id || '';
  FIELDS.forEach(f=>{ const el=$('#f_'+f); if(el) el.value = st?.[f] ?? ''; });
  $('#btnDelete').style.display = st ? 'block':'none';
  overlay.classList.add('show');
}
function closeModal(){ overlay.classList.remove('show'); }
function openEdit(id){ openModal(STATIONS.find(s=>s.id===id)); }

$('#btnSave').addEventListener('click',()=>{
  const lat=toNum($('#f_lat').value), lng=toNum($('#f_lng').value);
  if(!$('#f_name').value.trim()){ alert('กรุณาใส่ชื่อฟาร์ม/จุดติดตั้ง'); return; }
  if(lat==null||lng==null){ alert('กรุณาใส่พิกัด lat/lng (กดปักจุดบนแผนที่ หรือใช้ GPS ก็ได้)'); return; }
  const rec={id:$('#f_id').value||undefined};
  FIELDS.forEach(f=>{ rec[f]=$('#f_'+f).value.trim(); });
  rec.lat=lat; rec.lng=lng;
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
    $('#f_lat').value=p.coords.latitude.toFixed(6); $('#f_lng').value=p.coords.longitude.toFixed(6); $('#useGps').textContent='📍 ใช้ GPS ตอนนี้';
  },e=>{ alert('หาตำแหน่งไม่ได้: '+e.message); $('#useGps').textContent='📍 ใช้ GPS ตอนนี้'; },{enableHighAccuracy:true,timeout:10000});
});

/* ---------- ปักจุดบนแผนที่ ---------- */
let pickMode=false, pickMarker=null;
$('#pickMap').addEventListener('click',()=>{ pickMode=true; closeModal(); $('#pickBanner').style.display='flex'; });
$('#pickCancel').addEventListener('click',()=>{ pickMode=false; $('#pickBanner').style.display='none'; overlay.classList.add('show'); });
map.on('click',e=>{
  if(!pickMode) return;
  pickMode=false; $('#pickBanner').style.display='none';
  $('#f_lat').value=e.latlng.lat.toFixed(6); $('#f_lng').value=e.latlng.lng.toFixed(6);
  if(pickMarker) map.removeLayer(pickMarker);
  pickMarker=L.marker(e.latlng,{opacity:.7}).addTo(map);
  setTimeout(()=>{ if(pickMarker){ map.removeLayer(pickMarker); pickMarker=null; } },1500);
  overlay.classList.add('show');
});

/* ============================================================
   เชื่อมปุ่ม/อีเวนต์
   ============================================================ */
$('#list').addEventListener('click',e=>{ const row=e.target.closest('.station'); if(row) focusStation(row.dataset.id); });
$('#search').addEventListener('input',e=>{ searchText=e.target.value.trim().toLowerCase(); renderList(); });
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filters button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); activeFilter=b.dataset.f; renderList();
}));
$('#btnLoc').addEventListener('click',()=>locateMe());
$('#btnAdd').addEventListener('click',()=>openModal(null));
$('#fabAdd').addEventListener('click',()=>openModal(null));

// เปิดให้ปุ่มใน popup/list เรียกได้
window.DO = { nav:navigateTo, edit:openEdit, focus:focusStation };

/* ============================================================
   Service Worker (โหมดออฟไลน์) + เริ่มทำงาน
   ============================================================ */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW',e)));
}
initStore();
