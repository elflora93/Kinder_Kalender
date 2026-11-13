// Supabase Edge Function „google-kalender“
// Liest Noras Google-Kalender über die private iCal-Adresse (Secret ICAL_URL)
// und gibt die Termine der nächsten Wochen als einfache Liste zurück.
// Nur angemeldete Familien-Geräte dürfen sie aufrufen (JWT-Prüfung von Supabase).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const TZ = "Europe/Berlin";
const DAYS_BACK = 1;
const DAYS_AHEAD = 42;

type Prop = { name: string; params: Record<string, string>; value: string };
type DT = { y: number; m: number; d: number; min: number; allDay: boolean };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function parseLine(line: string): Prop | null {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(";");
  const params: Record<string, string> = {};
  parts.slice(1).forEach((p) => {
    const j = p.indexOf("=");
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, "");
  });
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(v: string) {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function berlin(date: Date): DT {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute, allDay: false };
}

function parseDT(prop: Prop): DT {
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return { y: +v.slice(0, 4), m: +v.slice(4, 6), d: +v.slice(6, 8), min: 0, allDay: true };
  }
  const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8), hh = +v.slice(9, 11), mm = +v.slice(11, 13);
  if (v.endsWith("Z")) return berlin(new Date(Date.UTC(y, m - 1, d, hh, mm)));
  // Mit TZID (in der Regel Europe/Berlin) oder ohne Zone: als Ortszeit lesen
  return { y, m, d, min: hh * 60 + mm, allDay: false };
}

const dayNum = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5);
const fromDayNum = (n: number) => { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const weekday = (n: number) => new Date(n * 864e5).getUTCDay(); // 0 = Sonntag
const isoDate = (n: number) => { const x = fromDayNum(n); return x.y + "-" + String(x.m).padStart(2, "0") + "-" + String(x.d).padStart(2, "0"); };
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function matchesRule(rule: Record<string, string>, startDay: number, day: number): boolean {
  const freq = rule.FREQ, interval = +(rule.INTERVAL || 1);
  const s = fromDayNum(startDay), c = fromDayNum(day);
  if (freq === "DAILY") return (day - startDay) % interval === 0;
  if (freq === "WEEKLY") {
    const days = rule.BYDAY ? rule.BYDAY.split(",").map((x) => WD[x.slice(-2)]) : [weekday(startDay)];
    if (days.indexOf(weekday(day)) < 0) return false;
    const monday = (n: number) => n - ((weekday(n) + 6) % 7);
    return Math.round((monday(day) - monday(startDay)) / 7) % interval === 0;
  }
  if (freq === "MONTHLY") {
    const months = (c.y - s.y) * 12 + (c.m - s.m);
    if (months < 0 || months % interval !== 0) return false;
    if (rule.BYDAY) {
      return rule.BYDAY.split(",").some((b) => {
        const ord = parseInt(b.slice(0, -2) || "0", 10), wd = WD[b.slice(-2)];
        if (weekday(day) !== wd) return false;
        if (!ord) return true;
        if (ord > 0) return Math.floor((c.d - 1) / 7) + 1 === ord;
        const last = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
        return Math.floor((last - c.d) / 7) + 1 === -ord;
      });
    }
    const md = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(",").map(Number) : [s.d];
    return md.indexOf(c.d) >= 0;
  }
  if (freq === "YEARLY") return c.m === s.m && c.d === s.d && (c.y - s.y) % interval === 0;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("ICAL_URL");
  if (!url) return json({ error: "ICAL_URL fehlt" }, 500);

  let text: string;
  try {
    const r = await fetch(url);
    if (!r.ok) return json({ error: "Google antwortet mit " + r.status }, 502);
    text = await r.text();
  } catch (_e) {
    return json({ error: "Google-Kalender nicht erreichbar" }, 502);
  }

  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = []; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (cur) { const p = parseLine(line); if (p) cur.push(p); }
  }

  const today = berlin(new Date());
  const winStart = dayNum(today.y, today.m, today.d) - DAYS_BACK;
  const winEnd = dayNum(today.y, today.m, today.d) + DAYS_AHEAD;

  // Einzeln geänderte Termine einer Serie (RECURRENCE-ID) aus der Serie herausnehmen
  const overridden = new Set<string>();
  for (const ev of events) {
    const rid = ev.find((p) => p.name === "RECURRENCE-ID");
    const uid = ev.find((p) => p.name === "UID")?.value || "";
    if (rid) { const d = parseDT(rid); overridden.add(uid + "|" + dayNum(d.y, d.m, d.d)); }
  }

  const out: unknown[] = [];
  for (const ev of events) {
    const get = (n: string) => ev.find((p) => p.name === n);
    if ((get("STATUS")?.value || "").toUpperCase() === "CANCELLED") continue;
    const dtstart = get("DTSTART");
    if (!dtstart) continue;
    const uid = get("UID")?.value || crypto.randomUUID();
    const title = unescapeText(get("SUMMARY")?.value || "Termin");
    const start = parseDT(dtstart);
    const startDay = dayNum(start.y, start.m, start.d);

    // Länge des Termins
    let spanDays = 0, endMin = start.allDay ? 0 : Math.min(1440, start.min + 60);
    const dtend = get("DTEND");
    if (dtend) {
      const e = parseDT(dtend);
      spanDays = dayNum(e.y, e.m, e.d) - startDay;
      endMin = e.min;
      if (start.allDay) spanDays = Math.max(1, spanDays);
      else if (spanDays > 0 && endMin === 0) { spanDays -= 1; endMin = 1440; } // endet genau um Mitternacht
    } else if (start.allDay) spanDays = 1;

    const rid = get("RECURRENCE-ID");
    const rrule = get("RRULE");
    const exdates = new Set<number>();
    ev.filter((p) => p.name === "EXDATE").forEach((p) => {
      p.value.split(",").forEach((v) => { const d = parseDT({ ...p, value: v }); exdates.add(dayNum(d.y, d.m, d.d)); });
    });

    let occurrences: number[] = [];
    if (rrule && !rid) {
      const rule: Record<string, string> = {};
      rrule.value.split(";").forEach((kv) => { const [k, v] = kv.split("="); rule[k.toUpperCase()] = v; });
      let until = Infinity;
      if (rule.UNTIL) { const u = parseDT({ name: "UNTIL", params: {}, value: rule.UNTIL }); until = dayNum(u.y, u.m, u.d); }
      const count = rule.COUNT ? +rule.COUNT : Infinity;
      let n = 0;
      const last = Math.min(winEnd, until, startDay + 366 * 5);
      for (let day = startDay; day <= last; day++) {
        if (!matchesRule(rule, startDay, day)) continue;
        n++;
        if (n > count) break;
        if (day < winStart - 31) continue;
        if (exdates.has(day) || overridden.has(uid + "|" + day)) continue;
        occurrences.push(day);
      }
    } else {
      occurrences = [startDay];
    }

    for (const day of occurrences) {
      if (start.allDay) {
        for (let k = 0; k < spanDays; k++) {
          const dd = day + k;
          if (dd >= winStart && dd <= winEnd) out.push({ uid: uid + "|" + dd, title, date: isoDate(dd), allDay: true });
        }
      } else {
        // Termin mit Uhrzeit, ggf. über mehrere Tage: ein Stück pro Tag
        for (let k = 0; k <= spanDays; k++) {
          const dd = day + k;
          if (dd < winStart || dd > winEnd) continue;
          const s = k === 0 ? start.min : 0;
          const e = k === spanDays ? endMin : 1440;
          if (e <= s && spanDays > 0) continue;
          out.push({ uid: uid + "|" + dd, title, date: isoDate(dd), start: s, end: spanDays > 0 ? e : Math.max(e, s + 15), allDay: false });
        }
      }
    }
  }

  return json({ events: out, abgerufen: new Date().toISOString() });
});
