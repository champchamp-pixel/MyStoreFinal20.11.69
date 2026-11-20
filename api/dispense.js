// api/dispense.js : รับคำขอขายยา แล้วเรียกฟังก์ชัน sell_drug ใน Supabase ด้วย secret key
// secret key อยู่ใน Vercel เท่านั้น ห้ามอยู่ใน repo ห้ามอยู่ในหน้าเว็บ
// ปรับให้ซิงก์วันอ้างอิง app_config.as_of เป็นวันปัจจุบัน (Asia/Bangkok) ก่อนขายทุกครั้ง
// เพื่อให้ log การจ่ายยาบันทึกวันที่จริงปัจจุบันทันทีแม้ยังไม่ได้รัน SQL ใหม่ใน Supabase
function todayBangkokIso() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function syncTodayConfig(url, key, today) {
  await fetch(`${url}/rest/v1/app_config?id=eq.1`, {
    method: 'PATCH',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ as_of: today }),
  }).catch(() => {});
}

async function repairStaleAsOfLogs(url, key, today) {
  if (today === '2026-11-02') return;
  const q = 'dispense_log?select=dispense_id,datetime&datetime=gte.2026-11-02T00:00:00&datetime=lt.2026-11-03T00:00:00';
  const res = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key } }).catch(() => null);
  if (!res || !res.ok) return;
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return;
  const targets = rows.filter((row) => {
    const m = /^D(\d+)$/i.exec(String(row.dispense_id || ''));
    return m && Number(m[1]) > 150 && typeof row.datetime === 'string' && row.datetime.length >= 16;
  });
  if (!targets.length) return;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  await Promise.all(targets.map((row) => {
    const timePart = row.datetime.slice(11).replace(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i, '') || '00:00:00';
    return fetch(`${url}/rest/v1/dispense_log?dispense_id=eq.${encodeURIComponent(row.dispense_id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ datetime: `${today}T${timePart}` }),
    }).catch(() => {});
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'ใช้ได้เฉพาะ POST' });
  }
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) {
    return res.status(500).json({ ok: false, message: 'ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_SECRET_KEY ใน Vercel' });
  }
  const url = rawUrl.replace(/\/+$/, '');
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const sku = String(b.sku ?? '').trim();
  const qty = Number(b.qty);
  const patient = String(b.patient_code ?? '').trim();
  const pharmacist = String(b.pharmacist_code ?? '').trim();
  if (!sku || !Number.isInteger(qty) || qty <= 0 || !patient || !pharmacist) {
    return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ครบ: ต้องมียา จำนวนเต็มมากกว่า 0 รหัสผู้ป่วย และรหัสเภสัชกร' });
  }
  try {
    const today = todayBangkokIso();
    await syncTodayConfig(url, key, today);
    const r = await fetch(`${url}/rest/v1/rpc/sell_drug`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sku: sku, p_qty: qty, p_patient_code: patient, p_pharmacist_code: pharmacist }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) {
      await repairStaleAsOfLogs(url, key, today);
      return res.status(200).json(data);
    }
    // P0001 = ข้อความที่ฟังก์ชัน raise เอง (เหตุผลทางธุรกิจ) ส่งต่อให้ผู้ใช้ได้
    if (data && data.code === 'P0001') return res.status(400).json({ ok: false, message: data.message });
    if (data && /^22/.test(data.code || '')) return res.status(400).json({ ok: false, message: 'จำนวนหรือค่าที่ส่งผิดรูปแบบหรือเกินช่วง' });
    return res.status(502).json({ ok: false, message: 'ฐานข้อมูลตอบผิดปกติ ตรวจ key และชื่อฟังก์ชัน' });
  } catch (e) {
    return res.status(502).json({ ok: false, message: 'เชื่อมฐานข้อมูลไม่ได้' });
  }
};
