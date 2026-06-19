/* ============================================================
   ⚙️  ตั้งค่าทั้งหมดอยู่ในไฟล์เดียวนี้ — แก้ตรงนี้พอ
   ============================================================ */

/* ----- ตั้งค่าแผนที่ ----- */
window.APP_CONFIG = {
  // จุดกึ่งกลางแผนที่ตอนเปิดครั้งแรก (ตอนยังไม่มีหมุด)
  mapCenter: [13.5, 101.0],
  mapZoom: 7,

  // 🔑 ใส่ Google Maps API Key ถ้าจะใช้แผนที่ Google (เว้นว่าง = ใช้ OpenStreetMap ฟรี)
  googleApiKey: "",

  // ถ้าไม่กรอกคอลัมน์ status: ค่า DO เก่ากว่ากี่นาที = ถือว่า "ออฟไลน์" (0 = ปิดการคำนวณ)
  offlineThresholdMinutes: 120,
};

/* ----- ตั้งค่า Firebase (สำหรับซิงค์ข้ามเครื่อง) -----
   วิธีเอาค่าพวกนี้มา: ดูใน README.md ขั้นตอนที่ 2
   ถ้ายังไม่กรอก (เป็น PASTE_...) แอปจะรันโหมดเดโมเก็บข้อมูลในเครื่องให้ลองก่อน
*/
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCo1JE1GMrK0pzwkImtcbsiuBL4mieZACs",
  authDomain: "map-do-9d8ff.firebaseapp.com",
  projectId: "map-do-9d8ff",
  storageBucket: "map-do-9d8ff.firebasestorage.app",
  messagingSenderId: "68947104296",
  appId: "1:68947104296:web:486e021e8c358fe56f1b1d",
};
