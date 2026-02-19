import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, doc, setDoc, deleteDoc, getDocs
} from "firebase/firestore";

// ── Task type registry ────────────────────────────────────────────────────────
const TASK_TYPES = {
  work:       { label: "Work",              color: "#3b6fe0" },
  review:     { label: "Review / Approval", color: "#e07c3b" },
  permit:     { label: "Permit",            color: "#111111" },
  gc_bid:     { label: "GC Bid",            color: "#22c55e" },
  furniture:  { label: "Furniture",         color: "#16a34a" },
  mer_freeze: { label: "MER Freeze",        color: "#dc2626" },
  mer_room:   { label: "MER Room",          color: "#1e3a8a" },
};
const barColor = (type) => TASK_TYPES[type]?.color ?? TASK_TYPES.work.color;

// ── App palette ───────────────────────────────────────────────────────────────
const C = {
  bg: "#0f1117", surface: "#1a1d27", border: "#2a2f45",
  blue: "#3b6fe0", blueLight: "#5a8af0", blueDim: "#1e3a7a",
  text: "#e8eaf0", textMuted: "#6b7280", textDim: "#9ca3af",
  red: "#e05555", green: "#34d399",
};

// ── Date helpers ──────────────────────────────────────────────────────────────
const pd      = (s) => { if (!s) return null; const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; };
const toStr   = (d) => d ? d.toISOString().slice(0, 10) : "";
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const addWeeks= (d, n) => addDays(d, n * 7);
const MONTHS  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function mondayBefore(d) {
  return addDays(d, -((d.getDay() - 1 + 7) % 7));
}
function buildTimeline(startStr, endStr) {
  const start = pd(startStr), end = pd(endStr);
  if (!start || !end) return [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const months = [];
  while (cur <= end) {
    const yr = cur.getFullYear(), mo = cur.getMonth();
    const w1 = mondayBefore(new Date(yr, mo, 1));
    months.push({ yr, mo, weeks: Array.from({ length: 4 }, (_, i) => {
      const ws = addDays(w1, i * 7);
      return { label: `W${i+1}`, start: ws, end: addDays(ws, 6) };
    })});
    cur = new Date(yr, mo + 1, 1);
  }
  return months;
}
function getBarCols(s0, e0, months) {
  const s = pd(s0), e = pd(e0);
  if (!s || !e || !months.length) return null;
  let sc = null, ec = null, i = 0;
  for (const m of months) for (const w of m.weeks) {
    if (sc === null && s <= w.end) sc = i;
    if (ec === null && e <= w.end) ec = i;
    i++;
  }
  if (sc === null) sc = 0;
  if (ec === null) ec = i - 1;
  if (sc > ec) ec = sc;
  return { sc, ec };
}
function getTodayCol(months) {
  const t = new Date(); let i = 0;
  for (const m of months) for (const w of m.weeks) {
    if (t >= w.start && t <= w.end) return i;
    i++;
  }
  return null;
}

// ── Firebase helpers (modular SDK) ────────────────────────────────────────────
const COLL = "gantt_projects";
const saveProject  = async (p) => await setDoc(doc(db, COLL, p.id), p);
const deleteFromDB = async (id) => await deleteDoc(doc(db, COLL, id));
const loadProjects = async () => {
  const snap = await getDocs(collection(db, COLL));
  return snap.docs.map(d => d.data());
};

// ── PNG export ────────────────────────────────────────────────────────────────
function loadScript(src, isReady) {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((s) => s.src === src);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureExportLibs(needPdf = false) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    () => !!window.html2canvas
  );
  if (needPdf) {
    await loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
      () => !!window.jspdf?.jsPDF
    );
  }
}

async function captureChartCanvas(el, scale = 2.2) {
  await ensureExportLibs(false);
  const width = Math.ceil(el.scrollWidth || el.offsetWidth);
  const height = Math.ceil(el.scrollHeight || el.offsetHeight);
  return window.html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
  });
}

function fitToCanvas(sourceCanvas, { width, height, padding = 80, background = "#ffffff" }) {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);

  const availW = Math.max(1, out.width - padding * 2);
  const availH = Math.max(1, out.height - padding * 2);
  const scale = Math.min(availW / sourceCanvas.width, availH / sourceCanvas.height);
  const drawW = Math.round(sourceCanvas.width * scale);
  const drawH = Math.round(sourceCanvas.height * scale);
  const dx = Math.round((out.width - drawW) / 2);
  const dy = Math.round((out.height - drawH) / 2);

  ctx.drawImage(sourceCanvas, dx, dy, drawW, drawH);
  return out;
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

async function exportPNG(el, filename) {
  const source = await captureChartCanvas(el, 2.2);
  const fitted = fitToCanvas(source, { width: 3200, height: 2000, padding: 88 });
  downloadCanvas(fitted, filename);
}

async function exportPDF(el, filename) {
  await ensureExportLibs(true);
  const source = await captureChartCanvas(el, 2.4);
  const fitted = fitToCanvas(source, { width: 3300, height: 2550, padding: 96 });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / fitted.width, maxH / fitted.height);
  const drawW = fitted.width * scale;
  const drawH = fitted.height * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(fitted.toDataURL("image/png"), "PNG", x, y, drawW, drawH, undefined, "FAST");
  pdf.save(filename);
}

// ── Factories ─────────────────────────────────────────────────────────────────
const uid      = () => crypto.randomUUID();
const todayStr = () => toStr(new Date());
const newTask  = (start) => ({ id: uid(), name: "New Task", startDate: start || todayStr(), endDate: toStr(addDays(pd(start) || new Date(), 14)), type: "work", durationLabel: "" });
const newPhase = () => ({ id: uid(), name: "New Phase", tasks: [] });

// ── Template project ──────────────────────────────────────────────────────────
function buildTemplateProject(startStr) {
  const s = pd(startStr) || new Date();
  const d = (offsetWeeks) => toStr(addWeeks(s, offsetWeeks));
  const t = (name, sw, ew, type = "work", durationLabel = "") => ({
    id: uid(), name, startDate: d(sw), endDate: d(ew), type, durationLabel,
  });
  return {
    id: uid(), name: "New Project", status: "In Progress", location: "",
    startDate: startStr, endDate: d(42), showToday: true,
    phases: [
      { id: uid(), name: "Design Start", tasks: [
        t("Site Survey",                        0,  1, "work"),
        t("Site Assessment Report",             1,  2, "work"),
        t("Colored Test-fit / Mood Board",      2,  4, "work"),
        t("Accessibility Report / ADA Document",3,  5, "review"),
      ]},
      { id: uid(), name: "Schematic Design", tasks: [
        t("Material Strategy",             5,  6, "work"),
        t("Demo / Power / Ceiling Plan",   5,  7, "work"),
        t("Furniture Solution Plan",       6,  8, "work"),
        t("EDG: Graphic Opportunity Plan", 7,  9, "work"),
        t("White Box Rendering",           7,  9, "work"),
        t("LOB Awareness",                 8,  9, "review"),
      ]},
      { id: uid(), name: "Design Development", tasks: [
        t("Demo / Power / RCP / Finish Plan", 9, 11, "work"),
        t("Material Strategy",                9, 10, "work"),
        t("AV Assignment Plan",               9, 11, "work"),
        t("Sound Masking Plan",              10, 12, "work"),
        t("Signage Location Plan",           10, 12, "work"),
        t("Power / HVAC Plan",               10, 12, "work"),
        t("MER / TR Design Layout",          11, 12, "review"),
      ]},
      { id: uid(), name: "Construction Documents", tasks: [
        t("Commissioning Engineer",           12, 15, "work"),
        t("Architecture / MEP / Low Voltage", 12, 16, "work"),
        t("WAP Location Plan",               13, 16, "work"),
        t("Security Permit Drawings",        14, 17, "work"),
        t("50% Page Turn",                   15, 16, "review"),
        t("Landlord Review Set",             16, 18, "work"),
        t("90% Page Turn",                   18, 19, "review"),
        t("Final CD Set",                    19, 22, "work"),
      ]},
      { id: uid(), name: "Permit", tasks: [
        t("Expedite Building Permit",             22, 42, "permit"),
        t("Permit Approval / Payment / Pickup",   38, 40, "permit"),
        t("Internal JPMC Permit Document Review", 16, 19, "work"),
      ]},
    ],
  };
}
const newProject = () => buildTemplateProject(todayStr());

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  "In Progress":"#3b6fe0","Permitting":"#e07c3b","In Design":"#8b5cf6",
  "Construction":"#34d399","Complete":"#6b7280","On Hold":"#e05555",
};
const StatusBadge = ({ status }) => {
  const c = STATUS_COLORS[status] || "#6b7280";
  return <span style={{ background: c+"22", color: c, border: `1px solid ${c}55`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{status}</span>;
};

// ── GANTT CHART ───────────────────────────────────────────────────────────────
const LABEL_W = 220, COL_W = 28, ROW_H = 22, HDR_H = 52;
const MIN_PREVIEW_COLS = 56;
const PREVIEW_DATE_LABEL = "February 18, 2026";

function GanttChart({ project }) {
  const allTaskDates = project.phases.flatMap(ph =>
    ph.tasks.flatMap(t => [t.startDate, t.endDate].filter(Boolean))
  );
  const timelineEnd = allTaskDates.length
    ? allTaskDates.reduce((a, b) => a > b ? a : b)
    : project.endDate;
  const months = buildTimeline(project.startDate, timelineEnd);
  let totalCols = months.reduce((s, m) => s + m.weeks.length, 0);
  if (months.length && totalCols < MIN_PREVIEW_COLS) {
    let cursor = new Date(months[months.length - 1].yr, months[months.length - 1].mo + 1, 1);
    while (totalCols < MIN_PREVIEW_COLS) {
      const yr = cursor.getFullYear();
      const mo = cursor.getMonth();
      const w1 = mondayBefore(new Date(yr, mo, 1));
      months.push({
        yr,
        mo,
        weeks: Array.from({ length: 4 }, (_, i) => {
          const ws = addDays(w1, i * 7);
          return { label: `W${i + 1}`, start: ws, end: addDays(ws, 6) };
        }),
      });
      totalCols += 4;
      cursor = new Date(yr, mo + 1, 1);
    }
  }
  const gridW     = totalCols * COL_W;
  const todayCol  = project.showToday !== false ? getTodayCol(months) : null;
  const usedTypes = new Set(project.phases.flatMap(ph => ph.tasks.map(t => t.type)));

  return (
    <div id="gantt-export-root" style={{ background: "white", color: "#111", fontFamily: "'DM Sans',sans-serif", minWidth: LABEL_W + gridW }}>
      {/* Title header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10, borderBottom: "2.5px solid #111", paddingBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "#666", textTransform: "uppercase" }}>Project Management &amp; Logistics</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 1 }}>
            {project.name} <span style={{ fontWeight: 300, color: "#666" }}>| SCHEDULE</span>
            {(() => {
              const s = pd(project.startDate), e = pd(project.endDate);
              if (!s || !e) return null;
              const weeks = Math.round((e - s) / (7 * 24 * 60 * 60 * 1000));
              return <span style={{ fontWeight: 300, color: "#888", fontSize: 18, marginLeft: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>{weeks} Weeks</span>;
            })()}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#888", textAlign: "right" }}>
          {project.location && <div>{project.location}</div>}
          <div style={{ marginTop: 2 }}>{PREVIEW_DATE_LABEL}</div>
        </div>
      </div>

      <div style={{ display: "flex" }}>
        {/* Label column */}
        <div style={{ width: LABEL_W, flexShrink: 0 }}>
          <div style={{ height: HDR_H }} />
          {project.phases.map(phase => (
            <div key={phase.id}>
              <div style={{ height: ROW_H, display: "flex", alignItems: "center", fontWeight: 800, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", background: "#ebebeb", paddingLeft: 6, borderBottom: "1px solid #ccc" }}>{phase.name}</div>
              {phase.tasks.map(task => (
                <div key={task.id} style={{ height: ROW_H, display: "flex", alignItems: "center", fontSize: 9, paddingLeft: 14, borderBottom: "1px solid #eee", color: "#222" }}>{task.name}</div>
              ))}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ position: "relative", width: gridW, flexShrink: 0 }}>
          {/* Month headers */}
          <div style={{ display: "flex", height: 26, borderBottom: "1px solid #bbb" }}>
            {months.map((m, mi) => (
              <div key={mi} style={{ width: m.weeks.length * COL_W, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", borderRight: "1px solid #bbb", background: "#111", color: "white" }}>
                {MONTHS[m.mo]}-{String(m.yr).slice(2)}
              </div>
            ))}
          </div>
          {/* Week headers */}
          <div style={{ display: "flex", height: 26, borderBottom: "2px solid #999" }}>
            {months.map((m, mi) => m.weeks.map((w, wi) => (
              <div key={`${mi}-${wi}`} style={{ width: COL_W, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 600, color: "#666", borderRight: "1px solid #e0e0e0", background: wi === 0 ? "#f2f2f2" : "white" }}>{w.label}</div>
            )))}
          </div>

          {/* Phase + task rows */}
          {project.phases.map(phase => {
            const phaseStartDates = phase.tasks.map(t => t.startDate).filter(Boolean);
            const phaseEndDates   = phase.tasks.map(t => t.endDate).filter(Boolean);
            const phaseStart = phaseStartDates.length ? phaseStartDates.reduce((a, b) => a < b ? a : b) : null;
            const phaseEnd   = phaseEndDates.length   ? phaseEndDates.reduce((a, b)   => a > b ? a : b) : null;
            const phaseBar   = getBarCols(phaseStart, phaseEnd, months);
            const phaseWeeks = (phaseStart && phaseEnd && pd(phaseStart) && pd(phaseEnd))
              ? Math.ceil((pd(phaseEnd) - pd(phaseStart)) / (7 * 24 * 60 * 60 * 1000))
              : null;
            return (
              <div key={phase.id}>
                <div style={{ position: "relative", display: "flex", height: ROW_H, background: "#ebebeb", borderBottom: "1px solid #ccc" }}>
                  {months.map((m, mi) => m.weeks.map((_, wi) => <div key={`${mi}-${wi}`} style={{ width: COL_W, borderRight: "1px solid #e0e0e0", height: "100%" }} />))}
                  {phaseBar && (
                    <div style={{ position: "absolute", top: 4, left: phaseBar.sc * COL_W + 2, width: (phaseBar.ec - phaseBar.sc + 1) * COL_W - 4, height: ROW_H - 8, background: "#444", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {phaseWeeks && <span style={{ color: "white", fontSize: 7, fontWeight: 700, whiteSpace: "nowrap" }}>{phaseWeeks} Weeks</span>}
                    </div>
                  )}
                </div>
                {phase.tasks.map(task => {
                  const bar = getBarCols(task.startDate, task.endDate, months);
                  return (
                    <div key={task.id} style={{ position: "relative", display: "flex", height: ROW_H, borderBottom: "1px solid #eee" }}>
                      {months.map((m, mi) => m.weeks.map((_, wi) => (
                        <div key={`${mi}-${wi}`} style={{ width: COL_W, borderRight: "1px solid #eee", height: "100%", background: wi === 0 ? "#fafafa" : "white" }} />
                      )))}
                      {bar && (
                        <div style={{ position: "absolute", top: 4, left: bar.sc * COL_W + 2, width: (bar.ec - bar.sc + 1) * COL_W - 4, height: ROW_H - 8, background: barColor(task.type), borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {task.durationLabel && <span style={{ color: "white", fontSize: 7, fontWeight: 700, whiteSpace: "nowrap" }}>{task.durationLabel}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Today line */}
          {todayCol !== null && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: todayCol * COL_W + COL_W / 2 - 0.75, width: 1.5, background: "#ef4444", pointerEvents: "none", zIndex: 10 }}>
              <div style={{ position: "absolute", top: HDR_H - 14, left: -12, background: "#ef4444", color: "white", fontSize: 6, fontWeight: 700, padding: "1px 3px", borderRadius: 2, whiteSpace: "nowrap" }}>TODAY</div>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, paddingTop: 8, borderTop: "1px solid #ddd" }}>
        {Object.entries(TASK_TYPES).filter(([key]) => usedTypes.has(key)).map(([key, t]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 20, height: 8, background: t.color, borderRadius: 1, border: key === "permit" ? "1px solid #aaa" : "none" }} />
            <span style={{ fontSize: 10, color: "#555" }}>{t.label}</span>
          </div>
        ))}
        {project.showToday !== false && todayCol !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 2, height: 10, background: "#ef4444" }} />
            <span style={{ fontSize: 10, color: "#555" }}>Today</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MINI GANTT ────────────────────────────────────────────────────────────────
function MiniGantt({ project }) {
  const months    = buildTimeline(project.startDate, project.endDate);
  const totalCols = months.reduce((s, m) => s + m.weeks.length, 0);
  if (!totalCols) return <div style={{ color: C.textMuted, fontSize: 11 }}>No timeline set</div>;
  const CW = 10, RH = 8, LW = 90;
  return (
    <div style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", marginLeft: LW, marginBottom: 2 }}>
        {months.map((m, mi) => <div key={mi} style={{ width: m.weeks.length * CW, fontSize: 7, color: C.textMuted, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap" }}>{MONTHS[m.mo]}</div>)}
      </div>
      {project.phases.flatMap(p => p.tasks).slice(0, 14).map(task => {
        const bar = getBarCols(task.startDate, task.endDate, months);
        return (
          <div key={task.id} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
            <div style={{ width: LW, fontSize: 8, color: C.textDim, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", paddingRight: 6 }}>{task.name}</div>
            <div style={{ position: "relative", width: totalCols * CW, height: RH }}>
              {bar && <div style={{ position: "absolute", left: bar.sc * CW, width: (bar.ec - bar.sc + 1) * CW, height: RH, background: barColor(task.type), borderRadius: 1 }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PROJECT CARD ──────────────────────────────────────────────────────────────
function ProjectCard({ project, onOpen, onDelete, onDuplicate }) {
  const taskCount = project.phases.reduce((s, p) => s + p.tasks.length, 0);
  return (
    <div className="project-card" onClick={() => onOpen(project.id)}
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, cursor: "pointer", transition: "border-color 0.15s, transform 0.1s", position: "relative" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = ""; }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
        <button onClick={() => onDuplicate(project.id)} title="Duplicate"
          style={{ background: `${C.blue}22`, border: `1px solid ${C.blue}44`, color: C.blueLight, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>⧉</button>
        <button onClick={() => { if (window.confirm("Delete this project?")) onDelete(project.id); }} title="Delete"
          style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><StatusBadge status={project.status} /></div>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 2 }}>{project.name}</div>
      {project.location && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{project.location}</div>}
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 12 }}>
        {project.startDate} → {project.endDate} &nbsp;·&nbsp; {project.phases.length} phases &nbsp;·&nbsp; {taskCount} tasks
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}><MiniGantt project={project} /></div>
    </div>
  );
}

// ── EDITOR ────────────────────────────────────────────────────────────────────
function GanttEditor({ project, onChange }) {
  const upd = (fn) => { const next = JSON.parse(JSON.stringify(project)); fn(next); onChange(next); };

  const handleStartDateChange = (newStart) => {
    upd(p => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const oldProjectStart = pd(p.startDate);
      const nextStart = pd(newStart);
      const firstTaskStart = pd(p.phases?.[0]?.tasks?.[0]?.startDate);
      const taskStartDates = p.phases.flatMap((phase) => phase.tasks.map((task) => pd(task.startDate))).filter(Boolean);
      const earliestStart = taskStartDates.length ? taskStartDates.reduce((min, d) => (d < min ? d : min)) : null;
      const anchorStart = firstTaskStart || earliestStart || oldProjectStart;

      p.startDate = newStart;
      if (!nextStart || !anchorStart) return;

      const dayShift = Math.round((nextStart - anchorStart) / DAY_MS);
      if (!dayShift) {
        // If there are legacy dates behind project start, normalize them.
        p.phases.forEach((phase) => {
          phase.tasks.forEach((task) => {
            const taskStart = pd(task.startDate);
            const taskEnd = pd(task.endDate);
            if (!taskStart || taskStart >= nextStart) return;
            const durationDays = taskEnd ? Math.max(0, Math.round((taskEnd - taskStart) / DAY_MS)) : 0;
            task.startDate = toStr(nextStart);
            if (taskEnd) task.endDate = toStr(addDays(nextStart, durationDays));
          });
        });
      }
      const projectEnd = pd(p.endDate);
      if (projectEnd && dayShift) p.endDate = toStr(addDays(projectEnd, dayShift));

      p.phases.forEach((phase) => {
        phase.tasks.forEach((task) => {
          const taskStart = pd(task.startDate);
          const taskEnd = pd(task.endDate);
          if (taskStart && dayShift) task.startDate = toStr(addDays(taskStart, dayShift));
          if (taskEnd && dayShift) task.endDate = toStr(addDays(taskEnd, dayShift));

          const shiftedStart = pd(task.startDate);
          const shiftedEnd = pd(task.endDate);
          if (shiftedStart && shiftedStart < nextStart) {
            const durationDays = shiftedEnd ? Math.max(0, Math.round((shiftedEnd - shiftedStart) / DAY_MS)) : 0;
            task.startDate = toStr(nextStart);
            if (shiftedEnd) task.endDate = toStr(addDays(nextStart, durationDays));
          }
        });
      });

      // Keep project end aligned with shifted tasks.
      const shiftedTaskEnds = p.phases
        .flatMap((phase) => phase.tasks.map((task) => pd(task.endDate)))
        .filter(Boolean);
      if (shiftedTaskEnds.length) {
        const maxEnd = shiftedTaskEnds.reduce((max, d) => (d > max ? d : max));
        p.endDate = toStr(maxEnd);
      }
    });
  };

  const inp = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: "4px 8px", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" };
  const lbl = { fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3, display: "block" };

  return (
    <div className="editor-root" style={{ padding: 20, fontFamily: "'DM Sans',sans-serif" }}>
      {/* Project meta */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Project Details</div>
        <div className="project-meta-grid" style={{ display: "grid", gap: 12, alignItems: "end" }}>
          <div>
            <label style={lbl}>Project Name</label>
            <input value={project.name || ""} onChange={e => upd(p => { p.name = e.target.value; })} style={inp} />
          </div>
          <div>
            <label style={lbl}>Location</label>
            <input value={project.location || ""} onChange={e => upd(p => { p.location = e.target.value; })} style={inp} />
          </div>
          <div>
            <label style={lbl}>Start Date</label>
            <input type="date" value={project.startDate || ""} onChange={e => handleStartDateChange(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>End Date</label>
            <input type="date" value={project.endDate || ""} onChange={e => upd(p => { p.endDate = e.target.value; })} style={inp} />
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select value={project.status} onChange={e => upd(p => { p.status = e.target.value; })} style={{ ...inp, cursor: "pointer" }}>
              {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="today-line-cell" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingBottom: 2 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Today Line</label>
            <input type="checkbox" checked={project.showToday !== false} onChange={e => upd(p => { p.showToday = e.target.checked; })} style={{ width: 18, height: 18, cursor: "pointer", accentColor: C.blue }} />
          </div>
        </div>
      </div>

      {/* Phases */}
      {project.phases.map((phase, pi) => (
        <div key={phase.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: "hidden" }}>
          <div className="phase-header-row" style={{ background: C.blueDim, padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <input value={phase.name} onChange={e => upd(p => { p.phases[pi].name = e.target.value; })}
              style={{ ...inp, background: "transparent", border: "none", color: "white", fontWeight: 700, fontSize: 13, flex: 1, padding: "2px 4px" }} />
            <button onClick={() => upd(p => p.phases.splice(pi, 1))}
              style={{ background: `${C.red}33`, border: `1px solid ${C.red}55`, color: C.red, borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Remove Phase</button>
          </div>
          <div className="phase-table-wrap" style={{ padding: "10px 14px" }}>
            <div className="phase-task-grid phase-task-header" style={{ display: "grid", gap: 8, marginBottom: 6 }}>
              {["Task Name","Start Date","End Date","Bar Type","Duration Label",""].map((h, i) => <div key={i} style={lbl}>{h}</div>)}
            </div>
            {phase.tasks.map((task, ti) => (
              <div className="phase-task-grid phase-task-row" key={task.id} style={{ display: "grid", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <input value={task.name} onChange={e => upd(p => { p.phases[pi].tasks[ti].name = e.target.value; })} style={inp} placeholder="Task name" />
                <input type="date" value={task.startDate} onChange={e => upd(p => { p.phases[pi].tasks[ti].startDate = e.target.value; p.phases[pi].tasks[ti]._customStart = true; })} style={inp} />
                <input type="date" value={task.endDate} onChange={e => upd(p => { p.phases[pi].tasks[ti].endDate = e.target.value; })} style={inp} />
                <select value={task.type} onChange={e => upd(p => { p.phases[pi].tasks[ti].type = e.target.value; })} style={{ ...inp, cursor: "pointer" }}>
                  {Object.entries(TASK_TYPES).map(([key, t]) => <option key={key} value={key} style={{ background: "#1a1d27" }}>{t.label}</option>)}
                </select>
                <input value={task.durationLabel} onChange={e => upd(p => { p.phases[pi].tasks[ti].durationLabel = e.target.value; })} style={inp} placeholder="e.g. 5 Weeks" />
                <button onClick={() => upd(p => p.phases[pi].tasks.splice(ti, 1))}
                  style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
            <button onClick={() => upd(p => {
              const last = p.phases[pi].tasks.slice(-1)[0];
              p.phases[pi].tasks.push(newTask(last?.endDate || p.startDate));
            })} style={{ background: `${C.blue}22`, border: `1px dashed ${C.blue}`, color: C.blueLight, borderRadius: 4, padding: "5px 14px", cursor: "pointer", fontSize: 11, fontWeight: 600, marginTop: 4 }}>
              + Add Task
            </button>
          </div>
        </div>
      ))}

      <button onClick={() => upd(p => p.phases.push(newPhase()))}
        style={{ background: C.surface, border: `1px dashed ${C.border}`, color: C.textDim, borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600, width: "100%", marginBottom: 20 }}>
        + Add Phase
      </button>

      {/* Color legend — only used types */}
      {(() => {
        const usedTypes = new Set(project.phases.flatMap(ph => ph.tasks.map(t => t.type)));
        const usedEntries = Object.entries(TASK_TYPES).filter(([k]) => usedTypes.has(k));
        if (!usedEntries.length) return null;
        return (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Bar Colors Used in This Project</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {usedEntries.map(([key, t]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 28, height: 12, background: t.color, borderRadius: 2, border: key === "permit" ? "1px solid #555" : "none" }} />
                  <span style={{ fontSize: 12, color: C.textDim }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [projects,  setProjects]  = useState([]);
  const [activeId,  setActiveId]  = useState(null);
  const [view,      setView]      = useState("dashboard");
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [msg,          setMsg]          = useState(null);
  const [exportingPNG, setExportingPNG] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const autoSaveTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const loaded = await loadProjects();
        if (cancelled) return;
        if (loaded.length) {
          setProjects(loaded);
        } else {
          const starter = newProject();
          setProjects([starter]);
          try { await saveProject(starter); } catch (e) { console.error("Initial save error:", e); }
        }
      } catch (e) {
        console.error("Firebase load error:", e);
        flash(`Load failed: ${e?.code || "unknown"} - ${e?.message || "no details"}`, true);
        if (!cancelled) setProjects([newProject()]);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const active = projects.find(p => p.id === activeId);
  const flash  = (text, err = false) => { setMsg({ text, err }); setTimeout(() => setMsg(null), 2500); };
  const queueAutoSave = (project) => {
    if (!project?.id) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSyncing(true);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveProject(project);
      } catch (e) {
        console.error("Auto-save failed:", e);
        flash(`Auto-save failed: ${e?.code || "unknown"} - ${e?.message || "no details"}`, true);
      } finally {
        setSyncing(false);
        autoSaveTimerRef.current = null;
      }
    }, 500);
  };


  const handleChange = (updated) => {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
    queueAutoSave(updated);
  };

  const handleNew = () => {
    const p = newProject();
    setProjects(prev => [...prev, p]);
    queueAutoSave(p);
    setActiveId(p.id); setView("edit");
  };

  const handleDuplicate = (id) => {
    const src = projects.find(p => p.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id    = uid();
    copy.name  = copy.name + " (Copy)";
    copy.phases = copy.phases.map(ph => ({ ...ph, id: uid(), tasks: ph.tasks.map(t => ({ ...t, id: uid() })) }));
    setProjects(prev => [...prev, copy]);
    queueAutoSave(copy);
    flash("Project duplicated ✓");
  };

  const handleDelete = async (id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    try { await deleteFromDB(id); } catch {}
    if (activeId === id) { setActiveId(null); setView("dashboard"); }
  };

  const handleExportPNG = async () => {
    const el = document.getElementById("gantt-export-root");
    if (!el) { flash("Switch to Preview first", true); return; }
    setExportingPNG(true);
    try { await exportPNG(el, `${active?.name || "gantt"}-schedule.png`); flash("PNG exported!"); }
    catch (e) { flash("PNG export failed: " + e.message, true); }
    setExportingPNG(false);
  };

  const handleExportPDF = async () => {
    const el = document.getElementById("gantt-export-root");
    if (!el) { flash("Switch to Preview first", true); return; }
    setExportingPDF(true);
    try { await exportPDF(el, `${active?.name || "gantt"}-schedule.pdf`); flash("PDF exported!"); }
    catch (e) { flash("PDF export failed: " + e.message, true); }
    setExportingPDF(false);
  };

  const navBtn = (a) => ({ background: a ? C.blue : "none", border: `1px solid ${a ? C.blue : C.border}`, color: a ? "white" : C.textDim, borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s" });
  const btnPri = { background: C.blue, border: "none", color: "white", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" };
  const btnSec = { ...btnPri, background: "#252840" };

  if (loading) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontFamily: "sans-serif" }}>
      Loading projects…
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; font-family: 'DM Sans', sans-serif; }
        input:focus, select:focus { outline: 1px solid ${C.blue} !important; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .project-meta-grid { grid-template-columns: 1fr 1fr 140px 140px 160px auto; }
        .phase-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .phase-task-grid { grid-template-columns: minmax(220px, 1fr) 115px 115px 195px 115px 28px; min-width: 790px; }
        .dashboard-grid { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)) !important; }
        @media (max-width: 960px) {
          .editor-root { padding: 14px !important; }
          .project-meta-grid { grid-template-columns: 1fr 1fr !important; }
          .dashboard-root { padding: 20px 16px !important; }
        }
        @media (max-width: 700px) {
          .project-meta-grid { grid-template-columns: 1fr !important; }
          .today-line-cell { align-items: flex-start !important; }
          .phase-header-row { flex-wrap: wrap; }
          .phase-header-row button { width: 100%; }
          .phase-task-grid { min-width: 760px; }
          .dashboard-root { padding: 14px 10px !important; }
          .dashboard-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .project-card, .new-project-card { padding: 14px !important; }
        }
      `}</style>

      {/* NAV */}
      <div className="no-print" style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "10px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
        <div onClick={() => setView("dashboard")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
          <div style={{ width: 28, height: 28, background: C.blue, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="5" height="2.5" rx="1" fill="white" />
              <rect x="7" y="3" width="8" height="2.5" rx="1" fill="white" opacity="0.5" />
              <rect x="1" y="7" width="8" height="2.5" rx="1" fill="white" />
              <rect x="10" y="7" width="5" height="2.5" rx="1" fill="white" opacity="0.5" />
              <rect x="1" y="11" width="4" height="2.5" rx="1" fill="white" />
              <rect x="6" y="11" width="9" height="2.5" rx="1" fill="white" opacity="0.5" />
            </svg>
          </div>
          <span style={{ fontWeight: 800, fontSize: 14, color: C.text, letterSpacing: "0.03em" }}>GANTTFLOW</span>
        </div>

        {view !== "dashboard" && active && (
          <>
            <button style={navBtn(view === "edit")}    onClick={() => setView("edit")}>Edit</button>
            <button style={navBtn(view === "preview")} onClick={() => setView("preview")}>Preview</button>
          </>
        )}

        <div style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 11, fontWeight: 600, color: msg.err ? C.red : C.green }}>{msg.text}</span>}
        {syncing && <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>Syncing...</span>}

        {view !== "dashboard" && active && (
          <>
            <button style={btnSec} onClick={handleExportPNG} disabled={exportingPNG || exportingPDF}>{exportingPNG ? "Exporting…" : "🖼 Export PNG"}</button>
            <button style={btnSec} onClick={handleExportPDF} disabled={exportingPNG || exportingPDF}>{exportingPDF ? "Exporting…" : "📄 Export PDF"}</button>
          </>
        )}
        <button style={btnPri} onClick={handleNew}>+ New Project</button>
      </div>

      {/* DASHBOARD */}
      {view === "dashboard" && (
        <div className="no-print dashboard-root" style={{ padding: "32px 28px" }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.01em" }}>Project Schedules</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{projects.length} project{projects.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))", gap: 20 }}>
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} onOpen={id => { setActiveId(id); setView("edit"); }} onDelete={handleDelete} onDuplicate={handleDuplicate} />
            ))}
            <div className="new-project-card" onClick={handleNew}
              style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 10, padding: 18, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 180, gap: 8, color: C.textMuted, transition: "border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ fontSize: 32 }}>＋</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>New Project</div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT */}
      {view === "edit" && active && (
        <div className="no-print">
          <div style={{ padding: "10px 24px", background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
            <span onClick={() => setView("dashboard")} style={{ cursor: "pointer" }}>Projects</span>
            <span>›</span>
            <span style={{ color: C.text, fontWeight: 600 }}>{active.name}</span>
            <StatusBadge status={active.status} />
          </div>
          <GanttEditor project={active} onChange={handleChange} />
        </div>
      )}

      {/* PREVIEW */}
      {view === "preview" && active && (
        <div className="no-print" style={{ padding: 32, background: C.bg }}>
          <div style={{ background: "white", borderRadius: 8, padding: 24, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", overflowX: "auto" }}>
            <GanttChart project={active} />
          </div>
        </div>
      )}

    </>
  );
}

