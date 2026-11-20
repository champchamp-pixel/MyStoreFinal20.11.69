const el = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 });
const currency = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 1 });
const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
const thaiTime = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
});
const thaiClock = new Intl.DateTimeFormat('th-TH', { timeStyle: 'medium', timeZone: 'Asia/Bangkok' });
const narrow = matchMedia('(max-width: 820px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

const units = new Map([
  ['tablet', 'เม็ด'], ['capsule', 'แคปซูล'], ['bottle', 'ขวด'],
  ['tube', 'หลอด'], ['sachet', 'ซอง'], ['inhaler', 'อัน'],
]);
const statusLabels = new Map([
  ['active', 'ใช้งาน'], ['written_off', 'ตัดจำหน่าย'], ['quarantine', 'กักกัน'],
  ['dispense', 'จ่ายยา'], ['return', 'คืนยา'], ['void', 'ยกเลิก'],
  ['drug_active', 'เปิดใช้งาน'], ['drug_inactive', 'ปิดใช้งาน'],
  ['stock', 'ล็อตถูกกักกัน'], ['dispense_pending', 'รายการจ่ายรอตรวจ'],
  ['stock_adjustments', 'ปรับยอดคลังรอตรวจ'], ['incidents', 'อุบัติการณ์เปิดอยู่'],
]);
const incidentTypeLabels = new Map([
  ['expired_drug_dispensed', 'จ่ายยาหมดอายุ'],
]);
const kindLabels = {
  catalog: 'ทะเบียนยา',
  stock: 'สต็อก',
  events: 'ประวัติการจ่าย',
  open: 'งานค้าง',
};
const expected = {
  catalog: ['sku', 'generic_name', 'strength', 'dosage_form', 'unit', 'category', 'atc_code'],
  stock: ['sku', 'stock_id', 'lot', 'status'],
  events: ['sku', 'dispense_id', 'lot', 'datetime', 'type'],
};
const ids = { catalog: 'sku', stock: 'stock_id', events: 'dispense_id' };
const tables = {
  catalog: ['ชื่อสามัญ / SKU', 'ความแรง', 'รูปแบบยา', 'หมวดหมู่', 'ATC', 'ใช้ได้ / จุดสั่งซื้อ'],
  stock: ['ยา / SKU', 'ล็อต / รหัส', 'หมดอายุ', 'คงเหลือ', 'ต้นทุน/หน่วย', 'สถานะ'],
  events: ['ยา / SKU', 'รหัสรายการ / วันเวลา (ไทย)', 'ล็อต', 'ผู้ป่วย / เภสัชกร', 'จำนวน', 'ประเภท'],
  open: ['ยา / SKU', 'รหัสเอกสาร', 'แหล่งข้อมูล', 'ล็อต', 'วันที่', 'รายละเอียด'],
};
const issueLabels = {
  'below-reorder': 'ต่ำกว่าจุดสั่งซื้อซ้ำ',
  'unknown-sku': 'SKU ไม่พบในทะเบียน',
  'ambiguous-lot': 'คู่ SKU และล็อตซ้ำ',
  'missing-expiry': 'วันหมดอายุขาดหรือไม่ถูกต้อง',
  'expiry-before-received': 'วันหมดอายุไม่เกินวันรับเข้า',
  'expired-stock': 'ล็อตหมดอายุที่ยังมียอด',
  'near-expiry': 'ล็อตใกล้หมดอายุ (≤ 90 วัน)',
  'quarantine-stock': 'ล็อตถูกกักกัน',
  'negative-stock': 'ยอดติดลบ',
  'missing-lot': 'หาล็อตในสต็อกไม่พบ',
  'invalid-time': 'วันเวลาไม่ถูกต้อง',
  'outside-period': 'วันที่อยู่นอกช่วงที่ระบุ',
  'after-as-of': 'วันที่อยู่หลังวันอ้างอิง (as_of)',
  'after-expiry': 'วันที่จ่ายหลังวันหมดอายุ',
  'open-incident': 'มีอุบัติการณ์เปิดอยู่',
  'fractional-qty': 'จำนวนเป็นทศนิยม',
  'nonpositive-issue': 'จำนวนไม่มากกว่า 0',
  'pending-dispense': 'รายการจ่ายรอตรวจหลักฐาน',
  'pending-adjustment': 'การปรับยอดคลังรอตรวจ',
};

let datasets = {};
let extras = {};
let model = {};
let sourceMode = 'supabase';
let view = 'catalog';
let page = 1;
let issueFilter = '';
let syncChart = () => {};
let chartObserver;
let generation = 0;
const pageSize = 12;
const metricAnimations = new Map();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(isoDate, days) {
  if (!validDate(isoDate)) return '';
  const ms = Date.parse(isoDate + 'T00:00:00Z') + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function diffDays(laterIso, earlierIso) {
  if (!validDate(laterIso) || !validDate(earlierIso)) return NaN;
  return Math.round((Date.parse(laterIso + 'T00:00:00Z') - Date.parse(earlierIso + 'T00:00:00Z')) / 86400000);
}

function dayLabel(value) {
  return validDate(value) ? thaiDate.format(new Date(value + 'T00:00:00Z')) : 'ไม่ระบุ';
}

function eventTime(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(value.trim());
  if (!match) return NaN;
  const [, datePart, hh, mm, ss = '00', frac = '', rawTz] = match;
  if (!validDate(datePart)) return NaN;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return NaN;
  let tz = '+07:00';
  if (rawTz) {
    if (/^z$/i.test(rawTz)) {
      tz = 'Z';
    } else {
      const tzParts = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(rawTz);
      const th = tzParts ? Number(tzParts[2]) : 99;
      const tm = tzParts && tzParts[3] ? Number(tzParts[3]) : 0;
      if (!tzParts || th > 23 || tm > 59) return NaN;
      tz = `${tzParts[1]}${tzParts[2]}:${tzParts[3] || '00'}`;
    }
  }
  const ms = frac ? `.${frac.slice(0, 3).padEnd(3, '0')}` : '';
  // คอลัมน์ dispense_log.datetime ใน Supabase เป็น timestamp without time zone ที่บันทึกเวลา Asia/Bangkok (+07:00)
  return Date.parse(`${datePart}T${hh}:${mm}:${ss}${ms}${tz}`);
}

function dispenseSeqNum(id) {
  const match = /^D(\d+)$/i.exec(String(id ?? '').trim());
  return match ? Number(match[1]) : 0;
}

function bangkokDate(timestamp) {
  return new Date(timestamp + 7 * 3600000).toISOString().slice(0, 10);
}

function validateItems(kind, items, { coerceNumbers = false } = {}) {
  const seen = new Set();
  const normalized = [];
  for (const [i, rawRow] of items.entries()) {
    const row = coerceNumbers ? { ...rawRow } : rawRow;
    const invalid = expected[kind].find((key) => typeof row?.[key] !== 'string' || !row[key].trim());
    if (invalid) throw Error(`รายการ ${i + 1} ขาด ${invalid}`);
    const identity = kind === 'catalog' ? normalize(row[ids[kind]]) : row[ids[kind]];
    if (seen.has(identity)) throw Error(`พบ ${ids[kind]} ซ้ำที่รายการ ${i + 1}`);
    seen.add(identity);
    const quantityKey = { catalog: 'reorder_level', stock: 'qty_on_hand', events: 'qty' }[kind];
    const quantityValue = coerceNumbers ? toFiniteNumber(row[quantityKey]) : row[quantityKey];
    if (typeof quantityValue !== 'number' || !Number.isFinite(quantityValue)) {
      throw Error(`รายการ ${i + 1} มี ${quantityKey} ที่ไม่ใช่ตัวเลข`);
    }
    if (coerceNumbers) {
      row[quantityKey] = quantityValue;
      if (kind === 'stock' && row.unit_cost !== undefined && row.unit_cost !== null) {
        row.unit_cost = toFiniteNumber(row.unit_cost);
      }
      if (kind === 'catalog') {
        for (const k of ['lot_count', 'usable_qty', 'quarantine_qty']) {
          if (row[k] !== undefined && row[k] !== null) row[k] = toFiniteNumber(row[k]);
        }
      }
    }
    if (kind === 'catalog' && (!Number.isSafeInteger(row.reorder_level) || row.reorder_level < 0)) {
      throw Error(`รายการ ${i + 1} มีจุดสั่งซื้อซ้ำไม่ถูกต้อง`);
    }
    normalized.push(row);
  }
  return normalized;
}

function parseDataset(raw, name) {
  const doc = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!Array.isArray(doc?.items)) throw Error('ต้องมี items เป็นรายการข้อมูล');
  const first = doc.items[0];
  const file = name.toLowerCase();
  const kind = first?.stock_id !== undefined || /stock/.test(file) ? 'stock'
    : first?.dispense_id !== undefined || /dispense/.test(file) ? 'events'
    : first?.generic_name !== undefined || /drugs/.test(file) ? 'catalog' : '';
  if (!kind) throw Error('ระบุประเภทไฟล์ไม่ได้');
  const items = validateItems(kind, doc.items, { coerceNumbers: false });
  return { kind, name, items, meta: doc.meta ?? {} };
}

const lotKey = (row) => JSON.stringify([normalize(row.sku), row.lot]);

function buildModel() {
  const catalog = datasets.catalog?.items ?? [];
  const materials = new Map(catalog.map((product) => [normalize(product.sku), product]));
  const stock = datasets.stock?.items ?? [];
  const eventsRaw = datasets.events?.items ?? [];
  const incidentsRaw = extras.incidents?.items ?? [];
  const pendingRaw = extras.dispense_pending?.items ?? [];
  const adjustmentsRaw = extras.stock_adjustments?.items ?? [];

  const lots = new Map();
  const stockBySku = new Map();
  const stockById = new Map();
  for (const row of stock) {
    const key = lotKey(row);
    const matches = lots.get(key) ?? [];
    matches.push(row);
    lots.set(key, matches);
    const skuKey = normalize(row.sku);
    const skuList = stockBySku.get(skuKey) ?? [];
    skuList.push(row);
    stockBySku.set(skuKey, skuList);
    stockById.set(row.stock_id, row);
  }

  const eventsById = new Map(eventsRaw.map((row) => [row.dispense_id, row]));
  const incidentsByDispense = new Map();
  for (const inc of incidentsRaw) {
    const list = incidentsByDispense.get(inc.dispense_id) ?? [];
    list.push(inc);
    incidentsByDispense.set(inc.dispense_id, list);
  }

  const snapshot = datasets.stock?.meta?.as_of || datasets.catalog?.meta?.as_of || datasets.events?.meta?.as_of || '';
  const nearExpiryLimit = addDays(snapshot, 90);
  const period = String(datasets.events?.meta?.period ?? '').match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const hasStockMetrics = Boolean(datasets.stock || catalog.some((row) => Number.isFinite(row.usable_qty)));

  const catalogModel = catalog.map((row) => {
    const skuLots = stockBySku.get(normalize(row.sku)) ?? [];
    const lotCount = Number.isFinite(row.lot_count) ? row.lot_count : skuLots.length;
    const usableQty = Number.isFinite(row.usable_qty)
      ? row.usable_qty
      : hasStockMetrics
        ? skuLots.reduce((sum, s) => sum + (
          s.status === 'active' && validDate(s.expiry) && (!validDate(snapshot) || s.expiry >= snapshot)
            ? s.qty_on_hand : 0
        ), 0)
        : null;
    const quarantineQty = Number.isFinite(row.quarantine_qty)
      ? row.quarantine_qty
      : hasStockMetrics
        ? skuLots.reduce((sum, s) => sum + (s.status === 'quarantine' ? s.qty_on_hand : 0), 0)
        : 0;
    const isActive = row.is_active !== false;
    const issues = [];
    // ตรงตาม v_below_reorder ใน 01_schema.sql (นับเฉพาะยาที่มีล็อตในคลังและใช้งานอยู่)
    if (isActive && lotCount > 0 && usableQty !== null && usableQty < row.reorder_level) {
      issues.push('below-reorder');
    }
    return { row, product: row, issues, lotCount, usableQty, quarantineQty, isActive };
  });

  const stockModel = stock.map((row) => {
    const issues = [];
    const product = materials.get(normalize(row.sku));
    const unitCost = toFiniteNumber(row.unit_cost);
    const daysLeft = validDate(snapshot) && validDate(row.expiry) ? diffDays(row.expiry, snapshot) : NaN;
    if (datasets.catalog && !product) issues.push('unknown-sku');
    if (lots.get(lotKey(row)).length > 1) issues.push('ambiguous-lot');
    if (!validDate(row.expiry)) {
      issues.push('missing-expiry');
    } else {
      if (validDate(row.received_date) && row.expiry <= row.received_date) issues.push('expiry-before-received');
      if (validDate(snapshot) && row.expiry < snapshot && row.qty_on_hand > 0) issues.push('expired-stock');
      else if (row.status === 'active' && row.qty_on_hand > 0 && validDate(snapshot) && row.expiry >= snapshot && row.expiry <= nearExpiryLimit) {
        issues.push('near-expiry');
      }
    }
    if (row.status === 'quarantine') issues.push('quarantine-stock');
    if (row.qty_on_hand < 0) issues.push('negative-stock');
    return { row, product, issues, unitCost, daysLeft };
  });

  const todayBkk = bangkokDate(Date.now());
  const eventsSorted = [...eventsRaw].sort((a, b) => {
    const aNum = dispenseSeqNum(a.dispense_id);
    const bNum = dispenseSeqNum(b.dispense_id);
    const aLive = aNum > 150 ? 1 : 0;
    const bLive = bNum > 150 ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    if (aLive && bLive) return bNum - aNum;
    const dtCmp = String(b.datetime || '').localeCompare(String(a.datetime || ''));
    return dtCmp !== 0 ? dtCmp : bNum - aNum;
  });

  const eventsModel = eventsSorted.map((row) => {
    const issues = [];
    const product = materials.get(normalize(row.sku));
    const matches = lots.get(lotKey(row)) ?? [];
    const [lot] = matches;
    const timestamp = eventTime(row.datetime);
    const linkedIncidents = incidentsByDispense.get(row.dispense_id) ?? [];
    const openIncidents = linkedIncidents.filter((inc) => inc.status === 'open');
    const isLiveTransaction = dispenseSeqNum(row.dispense_id) > 150;
    if (datasets.catalog && !product) issues.push('unknown-sku');
    if (datasets.stock && !matches.length) issues.push('missing-lot');
    if (matches.length > 1) issues.push('ambiguous-lot');
    if (!Number.isFinite(timestamp)) {
      issues.push('invalid-time');
    } else {
      const eventDate = bangkokDate(timestamp);
      if (period.length === 2) {
        if (eventDate < period[0] || eventDate > period[1]) issues.push('outside-period');
      } else if (validDate(snapshot)) {
        // รายการที่ขาย/คืนจริงในระบบ (> D0150) ใช้วันจริงวันนี้ จึงไม่แจ้งเตือนเท็จว่าเกิน as_of
        const cutoff = isLiveTransaction && todayBkk > snapshot ? todayBkk : snapshot;
        if (eventDate > cutoff) issues.push('after-as-of');
      }
      if (row.type === 'dispense' && matches.length === 1 && validDate(lot.expiry) && eventDate > lot.expiry) {
        issues.push('after-expiry');
      }
    }
    if (openIncidents.length) issues.push('open-incident');
    if ((row.type === 'dispense' || row.type === 'return') && !Number.isInteger(row.qty)) issues.push('fractional-qty');
    if ((row.type === 'dispense' || row.type === 'return') && row.qty <= 0) issues.push('nonpositive-issue');
    return { row, product, issues, timestamp, incidents: linkedIncidents };
  });

  // รวมงานค้างให้ตรงกับ view v_open_items ใน 01_schema.sql
  const hasWorkflowTables = Boolean(extras.incidents || extras.dispense_pending || extras.stock_adjustments);
  const openModel = [];
  if (hasWorkflowTables) {
    for (const item of stockModel) {
      if (item.row.status !== 'quarantine') continue;
      const reason = !validDate(item.row.expiry)
        ? 'ไม่มีวันหมดอายุ · ล็อตถูกกักไว้ รอตรวจฉลาก'
        : validDate(item.row.received_date) && item.row.expiry <= item.row.received_date
          ? 'วันหมดอายุไม่เกินวันรับเข้า · ล็อตถูกกักไว้ รอตรวจฉลาก'
          : 'ล็อตถูกกักไว้ รอตรวจฉลาก';
      openModel.push({
        row: {
          source: 'stock', record_id: item.row.stock_id, sku: item.row.sku,
          lot: item.row.lot, date: item.row.received_date, detail: reason,
        },
        product: item.product,
        issues: ['quarantine-stock'],
      });
    }
    for (const pending of pendingRaw) {
      if (pending.status !== 'pending_review') continue;
      const raw = pending.raw ?? {};
      const sku = typeof raw.sku === 'string' ? raw.sku : '';
      const lot = typeof raw.lot === 'string' ? raw.lot : '';
      const rawDate = typeof raw.datetime === 'string' ? raw.datetime.slice(0, 10) : '';
      openModel.push({
        row: {
          source: 'dispense_pending', record_id: pending.dispense_id, sku, lot,
          date: rawDate, detail: pending.reason,
        },
        product: materials.get(normalize(sku)),
        issues: ['pending-dispense'],
      });
    }
    for (const adj of adjustmentsRaw) {
      if (adj.status !== 'pending_review') continue;
      const lotRow = stockById.get(adj.stock_id);
      const sku = lotRow?.sku ?? '';
      openModel.push({
        row: {
          source: 'stock_adjustments', record_id: adj.adjustment_id, sku,
          lot: lotRow?.lot ?? adj.stock_id, date: adj.adj_date, detail: adj.note || adj.reason,
        },
        product: materials.get(normalize(sku)),
        issues: ['pending-adjustment'],
      });
    }
    for (const inc of incidentsRaw) {
      if (inc.status !== 'open') continue;
      const disp = eventsById.get(inc.dispense_id);
      const sku = disp?.sku ?? '';
      const label = incidentTypeLabels.get(inc.type) ?? inc.type;
      const expText = validDate(inc.lot_expiry) ? ` (หมดอายุ ${dayLabel(inc.lot_expiry)})` : '';
      openModel.push({
        row: {
          source: 'incidents', record_id: inc.incident_id, sku,
          lot: disp?.lot ?? '', date: inc.date_reported,
          detail: `${label} · อ้างอิง ${inc.dispense_id}${expText}`,
        },
        product: materials.get(normalize(sku)),
        issues: ['open-incident'],
      });
    }
  }

  return {
    snapshot,
    hasStockMetrics,
    hasWorkflowTables,
    hasCatalogActiveFlag: catalog.some((row) => typeof row.is_active === 'boolean'),
    catalog: catalogModel,
    stock: stockModel,
    events: eventsModel,
    open: openModel,
  };
}

function statusOf(item) {
  if (view === 'catalog') {
    if (!model.hasCatalogActiveFlag) return '';
    return item.isActive ? 'drug_active' : 'drug_inactive';
  }
  if (view === 'stock') return item.row.status;
  if (view === 'events') return item.row.type;
  if (view === 'open') return item.row.source;
  return '';
}

function quantity(value, product) {
  return [number.format(value), units.get(product?.unit) ?? product?.unit].filter(Boolean).join(' ');
}

function cells(item) {
  const { row, product, issues } = item;
  const name = product?.generic_name ?? (row.sku || row.record_id);
  const identity = !row.sku || name === row.sku ? name : `${name} · ${row.sku}`;
  const alerts = issues.map((issue) => issueLabels[issue]).join(' · ');
  const badges = [];

  if (view === 'catalog') {
    if (!item.isActive) badges.push('ปิดใช้งาน');
    let stockSummary = quantity(row.reorder_level, product);
    if (model.hasStockMetrics && item.usableQty !== null) {
      if (item.lotCount > 0) {
        const qNote = item.quarantineQty > 0 ? ` · กักกัน ${number.format(item.quarantineQty)}` : '';
        stockSummary = `${quantity(item.usableQty, product)} / เกณฑ์ ${number.format(row.reorder_level)}${qNote}`;
      } else {
        stockSummary = `ยังไม่มีล็อต · เกณฑ์ ${quantity(row.reorder_level, product)}`;
      }
    }
    return {
      values: [identity, row.strength, row.dosage_form, row.category, row.atc_code, stockSummary],
      summary: name,
      subtitle: `${row.sku} · ${row.strength}`,
      alerts,
      badges,
    };
  }

  if (view === 'stock') {
    const expiryText = item.issues.includes('near-expiry') && Number.isFinite(item.daysLeft)
      ? `${dayLabel(row.expiry)} (เหลือ ${number.format(item.daysLeft)} วัน)`
      : dayLabel(row.expiry);
    const costText = Number.isFinite(item.unitCost) ? `${currency.format(item.unitCost)} บาท` : '—';
    return {
      values: [
        identity,
        `${row.lot} · ${row.stock_id}`,
        expiryText,
        quantity(row.qty_on_hand, product),
        costText,
        statusLabels.get(row.status) ?? row.status,
      ],
      summary: name,
      subtitle: `${row.lot} (${row.stock_id}) · ${quantity(row.qty_on_hand, product)}`,
      alerts,
      badges,
    };
  }

  if (view === 'events') {
    const time = Number.isFinite(item.timestamp) ? thaiTime.format(new Date(item.timestamp)) : 'ไม่ระบุ';
    const refNotes = [];
    if (row.ref_dispense_id) refNotes.push(`อ้างอิง ${row.ref_dispense_id}`);
    if (row.legacy_id) refNotes.push(`เดิม ${row.legacy_id}`);
    const refSuffix = refNotes.length ? ` (${refNotes.join(' · ')})` : '';
    for (const inc of item.incidents ?? []) {
      badges.push(inc.incident_id);
    }
    const actors = [row.patient_code, row.pharmacist_code].filter(Boolean).join(' / ') || '—';
    return {
      values: [
        identity,
        `${row.dispense_id} · ${time}${refSuffix}`,
        row.lot,
        actors,
        quantity(row.qty, product),
        statusLabels.get(row.type) ?? row.type,
      ],
      summary: name,
      subtitle: `${row.dispense_id} · ${time}`,
      alerts,
      badges,
    };
  }

  return {
    values: [
      identity,
      row.record_id,
      statusLabels.get(row.source) ?? row.source,
      row.lot || '—',
      dayLabel(row.date),
      row.detail,
    ],
    summary: `${row.record_id} · ${name}`,
    subtitle: `${statusLabels.get(row.source) ?? row.source} · ${dayLabel(row.date)}`,
    alerts: '',
    badges,
  };
}

function makeTableRow(item) {
  const row = node('tr');
  const { values, alerts, badges } = cells(item);
  values.forEach((value, index) => {
    const cell = node('td', value);
    if ((view === 'catalog' && index === 4) || (view === 'open' && index === 1)) cell.classList.add('row-code');
    if (index === 0) {
      if (alerts) cell.append(node('span', alerts, 'row-issue'));
      for (const badge of badges) cell.append(node('span', badge, 'row-badge'));
    }
    row.append(cell);
  });
  return row;
}

function tableHeaders(name) {
  return name === 'catalog' && !model.hasStockMetrics
    ? [...tables.catalog.slice(0, 5), 'จุดสั่งซื้อซ้ำ']
    : tables[name];
}

function makeMobileRow(item) {
  const row = node('li');
  const details = node('details');
  const { values, summary, subtitle, alerts, badges } = cells(item);
  const title = node('summary', summary);
  title.append(node('small', subtitle));
  if (alerts) title.append(node('span', alerts, 'row-issue'));
  for (const badge of badges) title.append(node('span', badge, 'row-badge'));
  const body = node('dl');
  const headers = tableHeaders(view);
  values.slice(1).forEach((value, i) => {
    const group = node('div');
    group.append(node('dt', headers[i + 1]), node('dd', value));
    body.append(group);
  });
  details.append(title, body);
  row.append(details);
  return row;
}

function renderRecords() {
  const query = normalize(el('search').value);
  const category = el('category').value;
  const status = el('status').value;
  const list = model[view] ?? [];
  const matches = list.filter((item) => {
    const { row, product, issues } = item;
    const incidentIds = (item.incidents ?? []).map((inc) => inc.incident_id);
    return (
      (!category || product?.category === category)
      && (!status || statusOf(item) === status)
      && (!issueFilter || issues.includes(issueFilter))
      && (!query || [
        row.sku, row.lot, row.dispense_id, row.stock_id, row.patient_code,
        row.pharmacist_code, row.ref_dispense_id, row.legacy_id, row.record_id,
        row.detail, product?.atc_code, product?.generic_name, ...incidentIds,
      ].some((value) => normalize(value).includes(query)))
    );
  });

  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, pages);
  const start = (page - 1) * pageSize;
  const visible = matches.slice(start, start + pageSize);

  const header = node('tr');
  for (const label of tableHeaders(view)) {
    const cell = node('th', label);
    cell.scope = 'col';
    header.append(cell);
  }
  el('table-head').replaceChildren(header);
  el('table-region').hidden = narrow.matches || !visible.length;
  el('mobile-records').hidden = !narrow.matches || !visible.length;
  el('table-body').replaceChildren(...(narrow.matches ? [] : visible.map(makeTableRow)));
  el('mobile-records').replaceChildren(...(narrow.matches ? visible.map(makeMobileRow) : []));
  el('empty-records').hidden = !!matches.length;
  el('empty-records').textContent = 'ไม่พบรายการที่ตรงกับตัวกรอง';
  const count = matches.length
    ? `แสดง ${number.format(start + 1)}–${number.format(start + visible.length)} จาก ${number.format(matches.length)} รายการ`
    : 'พบ 0 รายการ';
  el('result-count').textContent = issueFilter ? `${issueLabels[issueFilter]} · ${count}` : count;
  el('page-number').textContent = `${page} / ${pages}`;
  el('previous').disabled = page === 1;
  el('next').disabled = page >= pages;
  el('pagination').hidden = !matches.length;
  syncChart(category);
}

function isViewAvailable(name) {
  if (name === 'open') return Boolean(model.hasWorkflowTables);
  return Boolean(datasets[name]);
}

function setView(name, issue = '', selectedStatus = '') {
  view = isViewAvailable(name) ? name : (Object.keys(datasets)[0] || 'catalog');
  issueFilter = issue;
  page = 1;
  for (const button of el('view-choices').querySelectorAll('button')) {
    const key = button.dataset.view;
    if (key === 'open') button.hidden = !model.hasWorkflowTables;
    button.setAttribute('aria-pressed', String(key === view));
    button.disabled = !isViewAvailable(key);
  }
  for (const button of el('source-shortcuts').querySelectorAll('button')) {
    const key = button.dataset.source;
    if (key === 'open') button.hidden = !model.hasWorkflowTables;
    button.setAttribute('aria-current', String(key === view));
  }
  const statuses = [...new Set((model[view] ?? []).map((item) => statusOf(item)).filter(Boolean))];
  el('status').replaceChildren(
    new Option('ทุกสถานะ', ''),
    ...statuses.map((value) => new Option(statusLabels.get(value) ?? value, value)),
  );
  el('status').value = statuses.includes(selectedStatus) ? selectedStatus : '';
  el('status-field').hidden = !statuses.length;

  const dispenseCount = model.events.filter(({ row }) => row.type === 'dispense').length;
  const returnCount = model.events.filter(({ row }) => row.type === 'return').length;
  const voidCount = model.events.filter(({ row }) => row.type === 'void').length;
  const stockedCount = model.catalog.filter((item) => item.lotCount > 0).length;
  const inactiveCount = model.catalog.filter((item) => !item.isActive).length;
  const eventParts = [`จ่ายยา ${number.format(dispenseCount)}`];
  if (returnCount > 0) eventParts.push(`คืนยา ${number.format(returnCount)}`);
  eventParts.push(`ยกเลิก ${number.format(voidCount)} เหตุการณ์`);

  const notes = {
    catalog: datasets.catalog?.meta?.source === 'supabase'
      ? `เชื่อมจาก Supabase${datasets.catalog.meta.fromView ? ' (v_drug_catalog)' : ''} · มีล็อตในคลัง ${number.format(stockedCount)} รายการ${inactiveCount ? ` · ปิดใช้งาน ${number.format(inactiveCount)}` : ''}`
      : datasets.catalog?.meta?.version
        ? `ทะเบียนยาเวอร์ชัน ${datasets.catalog.meta.version}`
        : 'รายการอ้างอิงตาม SKU',
    stock: `ยอดคงเหลือ ณ ${dayLabel(model.snapshot)} (${sourceMode === 'supabase' ? 'ฐานข้อมูล Supabase' : 'ไฟล์สต็อก'})`,
    events: eventParts.join(' · '),
    open: `รวมงานค้างที่ต้องติดตามจากคลัง รายการจ่ายรอตรวจ ปรับยอด และอุบัติการณ์ (${number.format(model.open.length)} รายการ)`,
  };
  el('view-note').textContent = notes[view] ?? '';
  renderRecords();
}

function renderChecks() {
  const buttons = [];
  const checkKinds = [
    { kind: 'catalog', only: ['below-reorder'] },
    { kind: 'stock', exclude: [] },
    { kind: 'events', exclude: [] },
    { kind: 'open', only: ['pending-dispense', 'pending-adjustment'] },
  ];
  for (const { kind, only, exclude } of checkKinds) {
    if (!isViewAvailable(kind)) continue;
    const counts = new Map();
    for (const { issues } of model[kind] ?? []) {
      for (const issue of issues) {
        if (only && !only.includes(issue)) continue;
        if (exclude && exclude.includes(issue)) continue;
        counts.set(issue, (counts.get(issue) ?? 0) + 1);
      }
    }
    for (const [issue, count] of counts) {
      const button = node('button', `${issueLabels[issue]} · ${kindLabels[kind]}`);
      button.type = 'button';
      button.prepend(node('strong', number.format(count)));
      button.addEventListener('click', () => {
        el('search').value = el('category').value = '';
        setView(kind, issue);
        el('result-count').focus();
      });
      buttons.push(button);
    }
  }
  el('check-list').replaceChildren(...(buttons.length ? buttons : [node('p', 'ไม่พบรายการผิดปกติหรือค้างตรวจสอบในข้อมูลที่โหลด')]));
  const shortcut = el('review-shortcut');
  shortcut.hidden = !buttons.length;
  shortcut.textContent = buttons.length ? `ดู ${number.format(buttons.length)} ประเภทที่ควรตรวจ` : '';
}

function mountCharts() {
  chartObserver?.disconnect();
  const chart = el('bars');
  const ring = el('ring');
  chart.replaceChildren();
  for (const target of [ring, chart]) target.classList.remove('animate');
  const categories = new Map();
  for (const { row } of model.catalog) categories.set(row.category, (categories.get(row.category) ?? 0) + 1);
  const ranked = [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
  const palette = ['#76b900', '#000000', '#5a8d00', '#0046a4', '#5e5e5e', '#df6500', '#952fc6', '#3f8500',
    '#1a1a1a', '#757575', '#ef9100', '#4d1368', '#333333', '#e52020', '#898989', '#a7a7a7'];
  const total = model.catalog.length;
  let end = 0;
  let hovered = '';
  let selected = '';
  const slices = ranked.map(([label, count], index) => {
    const start = end;
    end += 360 * count / total;
    return { label, count, start, end, color: palette[index % palette.length] };
  });
  const buttons = new Map();
  el('replay').hidden = !total;
  el('chart-note').textContent = total ? 'เลือกหมวดจากวงแหวนหรือกราฟแท่งเพื่อกรองรายการ' : 'โหลดทะเบียนยาเพื่อดูกราฟตามหมวด';
  ring.style.removeProperty('--slices');

  function draw() {
    const current = slices.find(({ label }) => label === (hovered || selected));
    el('ring-number').textContent = total ? number.format(current?.count ?? total) : '—';
    el('ring-unit').textContent = current ? percent.format(current.count / total) : 'SKU';
    el('ring-caption').textContent = current ? current.label : total ? `รวม ${number.format(slices.length)} หมวด` : 'ยังไม่มีทะเบียนยา';
    if (!total) return;
    const spans = slices.flatMap((slice) => {
      const stop = slice.end - Math.min(.75, (slice.end - slice.start) * .12);
      const color = current && current !== slice ? slice.color + '60' : slice.color;
      return [`${color} ${slice.start}deg ${stop}deg`, `white ${stop}deg ${slice.end}deg`];
    });
    ring.style.setProperty('--slices', `conic-gradient(${spans.join(',')})`);
  }

  function choose(label) {
    hovered = '';
    el('category').value = el('category').value === label ? '' : label;
    page = 1;
    renderRecords();
  }

  function hit(event) {
    const box = ring.getBoundingClientRect();
    const x = event.clientX - box.left - box.width / 2;
    const y = event.clientY - box.top - box.height / 2;
    const radius = Math.hypot(x, y) / (box.width / 2);
    const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    return radius >= .64 && radius <= 1
      ? slices.find((slice) => angle >= slice.start && angle < slice.end)?.label : '';
  }

  ring.onclick = (event) => { const label = hit(event); if (label) choose(label); };
  ring.onpointermove = (event) => {
    if (event.pointerType !== 'mouse') return;
    const label = hit(event) ?? '';
    ring.style.cursor = label ? 'pointer' : '';
    if (hovered !== label) { hovered = label; draw(); }
  };
  ring.onpointerleave = () => { hovered = ''; draw(); };
  slices.forEach(({ label, color, count }, index) => {
    const button = node('button', undefined, 'bar');
    button.type = 'button';
    button.setAttribute('aria-label', `${label} ${number.format(count)} SKU (${percent.format(count / total)})`);
    button.style.setProperty('--color', color);
    button.style.setProperty('--delay', `${Math.min(index * 36, 450)}ms`);
    const heading = node('span', undefined, 'bar-label');
    heading.append(node('span', label), node('strong', number.format(count), 'mono'));
    const track = node('span', undefined, 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = node('span', undefined, 'bar-fill');
    fill.style.width = `${count / slices[0].count * 100}%`;
    track.append(fill);
    button.append(heading, track);
    button.addEventListener('click', () => choose(label));
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') { hovered = label; draw(); }
    });
    button.addEventListener('pointerleave', () => { hovered = ''; draw(); });
    buttons.set(label, button);
    chart.append(button);
  });

  chartObserver = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) { target.classList.add('animate'); chartObserver.unobserve(target); }
    }
  }, { threshold: .12 });
  for (const target of [ring, chart]) if (total) chartObserver.observe(target);
  el('replay').onclick = () => {
    for (const target of [ring, chart]) {
      chartObserver.unobserve(target);
      target.classList.remove('animate');
      void target.offsetWidth;
      target.classList.add('animate');
    }
  };
  draw();
  return (category) => {
    selected = category;
    for (const [label, button] of buttons) button.setAttribute('aria-pressed', String(label === category));
    draw();
  };
}

function setMetric(id, value) {
  const metric = el(id);
  const display = metric.firstElementChild;
  const finalText = value === undefined ? '—' : number.format(value);
  metric.lastElementChild.textContent = finalText;
  const pending = metricAnimations.get(id);
  if (pending) {
    cancelAnimationFrame(pending.frame);
    clearTimeout(pending.timer);
    metricAnimations.delete(id);
  }
  const previous = Number(display.dataset.count || 0);
  if (value === undefined || previous === value || reducedMotion.matches || document.hidden) {
    display.textContent = finalText;
    display.dataset.count = value ?? 0;
    return;
  }
  const start = performance.now();
  const animation = {};
  const finish = () => {
    cancelAnimationFrame(animation.frame);
    clearTimeout(animation.timer);
    display.textContent = finalText;
    display.dataset.count = value;
    metricAnimations.delete(id);
  };
  const draw = (now) => {
    const progress = Math.min(1, Math.max(0, (now - start) / 700));
    const count = Math.round(previous + (value - previous) * (1 - (1 - progress) ** 3));
    display.textContent = number.format(count);
    display.dataset.count = count;
    if (progress < 1) animation.frame = requestAnimationFrame(draw);
    else finish();
  };
  animation.frame = requestAnimationFrame(draw);
  animation.timer = setTimeout(finish, 800);
  metricAnimations.set(id, animation);
}

function setConnectionVisual(state, badgeText, titleText, metaText, consoleText) {
  const badge = el('dataset-label');
  badge.textContent = badgeText;
  badge.classList.toggle('is-live', state === 'live');
  badge.classList.toggle('is-error', state === 'error');

  const card = el('connection-card');
  card.classList.toggle('is-live', state === 'live');
  card.classList.toggle('is-error', state === 'error');
  el('connection-title').textContent = titleText;
  el('connection-meta').textContent = metaText;

  const consoleBox = el('hero-console');
  consoleBox.classList.toggle('is-ready', state === 'live' || state === 'json');
  consoleBox.classList.toggle('is-error', state === 'error');
  el('source-status').textContent = consoleText;
}

function showData({ preserveFilters = false } = {}) {
  const prevSearch = preserveFilters ? el('search').value : '';
  const prevCategory = preserveFilters ? el('category').value : '';
  const prevStatus = preserveFilters ? el('status').value : '';
  model = buildModel();
  const categories = [...new Set(model.catalog.map(({ row }) => row.category))].sort((a, b) => a.localeCompare(b, 'th'));

  for (const [id, value] of [
    ['metric-skus', datasets.catalog && model.catalog.length],
    ['metric-categories', datasets.catalog && categories.length],
    ['metric-lots', datasets.stock && model.stock.length],
    ['metric-events', datasets.events && model.events.length],
  ]) setMetric(id, value);

  const belowReorder = model.catalog.filter((item) => item.issues.includes('below-reorder')).length;
  const nearExpiry = model.stock.filter((item) => item.issues.includes('near-expiry')).length;
  const openCount = model.open.length;
  const snapshotParts = [];
  if (datasets.stock) {
    snapshotParts.push(`สต็อก ณ ${dayLabel(model.snapshot)}`);
    if (belowReorder > 0) snapshotParts.push(`ต่ำกว่าจุดสั่งซื้อ ${number.format(belowReorder)} รายการ`);
    if (nearExpiry > 0) snapshotParts.push(`ใกล้หมดอายุ ${number.format(nearExpiry)} ล็อต`);
    if (model.hasWorkflowTables) snapshotParts.push(`งานค้าง ${number.format(openCount)} รายการ`);
  } else {
    snapshotParts.push('เพิ่มข้อมูลสต็อกเพื่อดูยอดคงเหลือตามวันอ้างอิง');
  }
  el('snapshot').textContent = snapshotParts.join(' · ');
  el('overview-kicker').textContent = sourceMode === 'supabase' ? 'SUPABASE OVERVIEW' : 'DATA OVERVIEW';

  const sourceChips = Object.values(datasets).map(({ name, items }) =>
    node('li', `${name} · ${number.format(items.length)} รายการ`));
  if (model.hasWorkflowTables) {
    sourceChips.push(node('li', `งานค้าง (open items) · ${number.format(model.open.length)} รายการ`));
  }
  el('sources').replaceChildren(...sourceChips);
  el('sources').hidden = false;

  for (const button of el('source-shortcuts').querySelectorAll('button')) {
    const key = button.dataset.source;
    if (key === 'open') button.hidden = !model.hasWorkflowTables;
    button.disabled = !isViewAvailable(key);
  }
  el('category').replaceChildren(new Option('ทุกหมวด', ''), ...categories.map((name) => new Option(name, name)));
  el('category').disabled = !categories.length;
  el('category').value = categories.includes(prevCategory) ? prevCategory : '';
  el('search').value = prevSearch;
  el('dashboard').hidden = el('navigation').hidden = false;
  el('switch-supabase').hidden = sourceMode === 'supabase';
  syncChart = mountCharts();
  setView(isViewAvailable(view) ? view : Object.keys(datasets)[0], preserveFilters ? issueFilter : '', prevStatus);
  renderChecks();
}

function buildSupabaseDatasets(payload) {
  if (!payload || !Array.isArray(payload.drugs?.items) || !Array.isArray(payload.stock?.items) || !Array.isArray(payload.dispense_log?.items)) {
    throw Error('โครงสร้างข้อมูลจาก /api/data ไม่ครบถ้วน (ต้องมี drugs, stock, dispense_log)');
  }
  const usingCatalogView = Array.isArray(payload.catalog?.items) && payload.catalog.items.length > 0;
  const catalogSource = usingCatalogView ? payload.catalog : payload.drugs;
  const catalogItems = validateItems('catalog', catalogSource.items, { coerceNumbers: true });
  const stockItems = validateItems('stock', payload.stock.items, { coerceNumbers: true });
  const eventItems = validateItems('events', payload.dispense_log.items, { coerceNumbers: true });

  const nextDatasets = {
    catalog: {
      kind: 'catalog',
      name: usingCatalogView ? 'Supabase · v_drug_catalog' : 'Supabase · drugs',
      items: catalogItems,
      meta: { ...(catalogSource.meta ?? {}), source: 'supabase', fromView: usingCatalogView },
    },
    stock: {
      kind: 'stock',
      name: 'Supabase · stock',
      items: stockItems,
      meta: { ...(payload.stock.meta ?? {}), source: 'supabase' },
    },
    events: {
      kind: 'events',
      name: 'Supabase · dispense_log',
      items: eventItems,
      meta: { ...(payload.dispense_log.meta ?? {}), source: 'supabase' },
    },
  };

  const nextExtras = {};
  if (Array.isArray(payload.incidents?.items)) nextExtras.incidents = payload.incidents;
  if (Array.isArray(payload.dispense_pending?.items)) nextExtras.dispense_pending = payload.dispense_pending;
  if (Array.isArray(payload.stock_adjustments?.items)) nextExtras.stock_adjustments = payload.stock_adjustments;
  return { nextDatasets, nextExtras };
}

async function loadFromSupabase({ preserveFilters = false } = {}) {
  const attempt = ++generation;
  const refreshBtn = el('refresh-db');
  refreshBtn.disabled = true;
  refreshBtn.setAttribute('aria-busy', 'true');
  el('load-error').hidden = true;
  el('load-note').hidden = true;
  el('load-status').textContent = 'กำลังดึงข้อมูลล่าสุดจาก Supabase (/api/data)…';

  const host = location.hostname;
  if (location.protocol === 'file:') {
    refreshBtn.disabled = false;
    refreshBtn.removeAttribute('aria-busy');
    setConnectionVisual(
      'error',
      'เปิดจากไฟล์ในเครื่อง',
      'ไม่สามารถเรียก /api/data จาก file:// ได้',
      'เปิดผ่านลิงก์ https://<ชื่อโปรเจกต์>.vercel.app/ หรือรัน vercel dev',
      'รอการเชื่อมต่อผ่าน Vercel',
    );
    el('load-error').textContent = 'หน้านี้ถูกเปิดจากไฟล์ในเครื่อง จึงเชื่อม /api/data ไม่ได้ ให้ push ขึ้น GitHub แล้วเปิดผ่านลิงก์ Vercel หรือใช้ตัวเลือกนำเข้าไฟล์ JSON ด้านล่าง';
    el('load-error').hidden = false;
    el('load-status').textContent = '';
    el('json-fallback').open = true;
    return;
  }

  if (host.endsWith('github.io')) {
    refreshBtn.disabled = false;
    refreshBtn.removeAttribute('aria-busy');
    setConnectionVisual(
      'error',
      'ไม่รองรับ API บน GitHub Pages',
      'GitHub Pages ไม่รันโฟลเดอร์ api/',
      'เปิดผ่านลิงก์ https://<ชื่อโปรเจกต์>.vercel.app/ แทน',
      'ไม่พบ /api/data',
    );
    el('load-error').textContent = 'หน้านี้เปิดจาก GitHub Pages ซึ่งไม่รันไฟล์ในโฟลเดอร์ api/ ให้เปิดผ่านลิงก์ vercel.app แทน';
    el('load-error').hidden = false;
    el('load-status').textContent = '';
    el('json-fallback').open = true;
    return;
  }

  try {
    const response = await fetch('/api/data', { cache: 'no-store' });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const isHtml = !json && /<html|<!doctype/i.test(text);

    if (!response.ok || !json) {
      let message = (json && (json.error || json.message)) || `เชื่อมต่อ /api/data ไม่สำเร็จ (HTTP ${response.status})`;
      let hint = 'เปิดหน้า สถานะระบบ (status.html) เพื่อตรวจสอบทีละขั้น';
      if (response.status === 404 || isHtml) {
        message = 'ไม่พบ API ที่ /api/data';
        hint = (host === '127.0.0.1' || host === 'localhost')
          ? 'หากเปิดด้วย Live Server หรือ HTTP server ทั่วไปจะไม่มี /api/data ให้รันผ่าน vercel dev หรือเปิดบนลิงก์ vercel.app (หรือใช้ไฟล์ JSON สำรองด้านล่าง)'
          : 'ตรวจว่าไฟล์ api/data.js อยู่ที่รากของโปรเจกต์บน Vercel และ deploy เรียบร้อยแล้ว';
      } else if (response.status === 500) {
        hint = 'เพิ่ม SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ใน Vercel Environment Variables แล้ว Redeploy';
      } else if (response.status === 502) {
        hint = 'ตรวจค่า SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (sb_publishable_) และรัน schema → seed → sell_drug → crud ใน Supabase แล้วหรือยัง';
      }
      const err = new Error(message);
      err.hint = hint;
      throw err;
    }

    const { nextDatasets, nextExtras } = buildSupabaseDatasets(json);
    if (generation !== attempt) return;
    datasets = nextDatasets;
    extras = nextExtras;
    sourceMode = 'supabase';
    showData({ preserveFilters });

    const asOfLabel = dayLabel(model.snapshot);
    const updatedAt = thaiClock.format(new Date());
    setConnectionVisual(
      'live',
      'Supabase · เชื่อมต่อแล้ว',
      'เชื่อมต่อฐานข้อมูล Supabase แล้ว',
      `วันอ้างอิง ${asOfLabel} · อัปเดตล่าสุด ${updatedAt}`,
      `Supabase · ณ ${asOfLabel}`,
    );
    el('load-status').textContent = `โหลดข้อมูลจาก Supabase แล้ว (${updatedAt})`;
    if (json.catalog_error) {
      el('load-note').textContent = `หมายเหตุ: ${json.catalog_error} — แดชบอร์ดแสดงข้อมูลจากตาราง drugs และคำนวณยอดใช้ได้จาก stock ชั่วคราว`;
      el('load-note').hidden = false;
    }
  } catch (error) {
    if (generation !== attempt) return;
    setConnectionVisual(
      'error',
      'เชื่อมต่อ Supabase ไม่สำเร็จ',
      'เชื่อมต่อฐานข้อมูล Supabase ไม่สำเร็จ',
      error.hint || 'ตรวจการตั้งค่าและลองรีเฟรชอีกครั้ง',
      'เชื่อมต่อไม่ได้',
    );
    el('load-error').textContent = error.hint ? `${error.message} — ${error.hint}` : error.message;
    el('load-error').hidden = false;
    el('load-status').textContent = '';
    if (!Object.keys(datasets).length) el('json-fallback').open = true;
  } finally {
    if (generation === attempt) {
      refreshBtn.disabled = false;
      refreshBtn.removeAttribute('aria-busy');
    }
  }
}

async function loadLocalSources(sources, replace = false) {
  const attempt = ++generation;
  el('load-error').hidden = true;
  el('load-note').hidden = true;
  el('load-status').textContent = 'กำลังอ่านไฟล์ JSON…';
  try {
    const files = await Promise.all(sources.map(async ({ name, read }) => {
      try { return parseDataset(await read(), name); } catch (error) { throw Error(`${name} · ${error.message}`); }
    }));
    const incoming = {};
    for (const data of files) {
      const existing = incoming[data.kind];
      if (existing) {
        if (data.kind !== 'catalog') throw Error(`เลือกไฟล์${kindLabels[data.kind]}ครั้งละหนึ่งไฟล์`);
        if (existing.items.length > data.items.length) continue;
      }
      incoming[data.kind] = data;
    }
    if (generation !== attempt) return;
    const base = sourceMode === 'json' && !replace ? datasets : {};
    datasets = { ...base, ...incoming };
    extras = {};
    sourceMode = 'json';
    showData();
    const count = Object.keys(datasets).length;
    setConnectionVisual(
      'json',
      'โหมดไฟล์ JSON สำรอง',
      'กำลังแสดงข้อมูลจากไฟล์ JSON ในเครื่อง',
      `โหลดแล้ว ${number.format(count)} / 3 ประเภท · กดปุ่มรีเฟรชเพื่อเชื่อม Supabase`,
      `ไฟล์ JSON · ${number.format(count)} / 3 ประเภท`,
    );
    el('load-status').textContent = 'โหลดไฟล์ JSON แล้ว';
  } catch (error) {
    if (generation !== attempt) return;
    el('load-error').textContent = error.message;
    el('load-error').hidden = false;
    el('load-status').textContent = '';
  }
}

function loadLocalFiles(files) {
  if (files.length) {
    loadLocalSources(files.map((file) => ({
      name: file.name,
      read: () => file.size <= 10_000_000 ? file.text() : Promise.reject(Error('ไฟล์ใหญ่เกิน 10 MB')),
    })));
  }
}

el('refresh-db').addEventListener('click', () => loadFromSupabase({ preserveFilters: sourceMode === 'supabase' && Boolean(Object.keys(datasets).length) }));
el('switch-supabase').addEventListener('click', () => loadFromSupabase({ preserveFilters: false }));

el('file-input').addEventListener('change', (event) => {
  const files = Array.from(event.target.files);
  event.target.value = '';
  loadLocalFiles(files);
});

const dropZone = el('drop-zone');
let dragDepth = 0;
function setDragging(active) {
  dropZone.classList.toggle('is-dragging', active);
  el('drop-title').textContent = active ? 'วางไฟล์เพื่อโหลดข้อมูล' : 'ลากไฟล์ JSON มาวาง';
}

dropZone.addEventListener('dragenter', (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  setDragging(true);
});
dropZone.addEventListener('dragover', (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) setDragging(false);
});
dropZone.addEventListener('drop', (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) event.preventDefault();
  dragDepth = 0;
  setDragging(false);
  loadLocalFiles(files);
});

el('source-shortcuts').addEventListener('click', (event) => {
  const name = event.target.dataset.source;
  if (!name || !isViewAvailable(name)) return;
  el('search').value = el('category').value = '';
  setView(name);
  el('result-count').focus();
});
el('view-choices').addEventListener('click', (event) => {
  const name = event.target.dataset.view;
  if (name && isViewAvailable(name)) setView(name);
});
el('filters').addEventListener('submit', (event) => event.preventDefault());
el('filters').addEventListener('reset', (event) => {
  event.preventDefault();
  el('search').value = el('category').value = el('status').value = '';
  issueFilter = '';
  page = 1;
  renderRecords();
  el('search').focus();
});
for (const [id, event] of [['search', 'input'], ['category', 'change'], ['status', 'change']]) {
  el(id).addEventListener(event, () => { page = 1; renderRecords(); });
}
el('previous').addEventListener('click', () => { page -= 1; renderRecords(); });
el('next').addEventListener('click', () => { page += 1; renderRecords(); });
narrow.addEventListener('change', () => { if (model[view]) renderRecords(); });

loadFromSupabase();
