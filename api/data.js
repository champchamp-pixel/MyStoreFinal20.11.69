// api/data.js : อ่านข้อมูลจาก Supabase ด้วย publishable key (อ่านได้อย่างเดียวตาม RLS)
// คืน JSON รูปทรงเดียวกับไฟล์วันแรก (drugs / stock / dispense_log แต่ละก้อนมี meta และ items)
// เพิ่มจากแม่แบบวันที่ 2: catalog = บัญชียาทุกตัวจาก v_drug_catalog (มี is_active, lot_count, usable_qty)
//   สำหรับหน้า admin.html และ dashboard ส่วน drugs เดิมคงไว้ pos.html จึงใช้ได้โดยไม่ต้องแก้
// เพิ่มข้อมูลเสริมแบบ optional (incidents / dispense_pending / stock_adjustments) สำหรับแดชบอร์ด
const TABLES = {
  drugs: 'drugs?select=*&order=sku',
  stock: 'stock?select=*&order=stock_id',
  dispense_log: 'dispense_log?select=*&order=dispense_id',
  catalog: 'v_drug_catalog?select=*&order=sku',
  incidents: 'incidents?select=*&order=incident_id',
  dispense_pending: 'dispense_pending?select=*&order=dispense_id',
  stock_adjustments: 'stock_adjustments?select=*&order=adjustment_id',
};

const PAGE_SIZE = 1000;

// วันอ้างอิงของระบบยึดวันที่จริงปัจจุบันตามเวลาประเทศไทย (Asia/Bangkok) รูปแบบ YYYY-MM-DD
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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!rawUrl || !key) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้ง SUPABASE_URL หรือ SUPABASE_PUBLISHABLE_KEY ใน Vercel' });
  }
  const url = rawUrl.replace(/\/+$/, '');
  try {
    const headers = { apikey: key };            // ส่ง key ทาง header ชื่อ apikey เท่านั้น
    const get = async (path) => {
      const all = [];
      const sep = path.includes('?') ? '&' : '?';
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const reqPath = offset === 0 ? path : `${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
        const r = await fetch(`${url}/rest/v1/${reqPath}`, { headers });
        if (!r.ok) throw new Error(`Supabase ตอบ ${r.status} ที่ ${path.split('?')[0]}`);
        const chunk = await r.json();
        if (!Array.isArray(chunk)) return chunk;
        all.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
      }
      return all;
    };
    const getOptional = (path) => get(path).then(
      items => ({ items }),
      () => null);
    // catalog อ่านแยก ถ้ายังไม่ได้รัน crud.sql ข้อมูลเดิมยังส่งได้ dashboard และ pos.html จึงไม่พังตาม
    const getCatalog = get(TABLES.catalog).then(
      items => ({ items }),
      () => ({ error: 'ยังไม่มี v_drug_catalog ให้รัน crud.sql ใน Supabase' }));
    const [cfg, drugs, stock, dispense, catalog, incidents, pending, adjustments] = await Promise.all([
      get('app_config?select=as_of&id=eq.1'),
      get(TABLES.drugs), get(TABLES.stock), get(TABLES.dispense_log), getCatalog,
      getOptional(TABLES.incidents), getOptional(TABLES.dispense_pending), getOptional(TABLES.stock_adjustments),
    ]);
    // ตารางที่ไม่มีนโยบายอ่านจะคืน [] โดยไม่แจ้ง error จึงต้องตรวจเอง
    if (!cfg.length || !drugs.length || !stock.length) {
      return res.status(502).json({ error: 'ได้ข้อมูลว่าง ตรวจนโยบายสิทธิ์เข้าถึงแถว (RLS) ของตาราง' });
    }
    const meta = { as_of: todayBangkokIso(), config_as_of: cfg[0].as_of, source: 'supabase' };
    const out = {
      drugs: { meta, items: drugs },
      stock: { meta, items: stock },
      dispense_log: { meta, items: dispense },
    };
    if (catalog.items) out.catalog = { meta, items: catalog.items };
    else out.catalog_error = catalog.error;
    if (incidents) out.incidents = { meta, items: incidents.items };
    if (pending) out.dispense_pending = { meta, items: pending.items };
    if (adjustments) out.stock_adjustments = { meta, items: adjustments.items };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
