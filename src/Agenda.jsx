import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Inbox, CalendarDays, Sun, Plus, Trash2, Check, X, Pencil, ChevronLeft, ChevronRight, ChevronUp, Loader2, AlertCircle, LogOut, FolderKanban, GripVertical, CalendarPlus } from "lucide-react";
import { supabase } from "./supabase";

// ---------- helpers de fecha (sin librerías) ----------
const DAY_MS = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfWeek = (d) => { const x = startOfDay(d); const w = (x.getDay() + 6) % 7; return addDays(x, -w); }; // lunes
const fmtHora = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const minAHora = (min) => { const d = new Date(); d.setHours(Math.floor(min / 60) % 24, min % 60, 0, 0); return fmtHora(d); };
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DIA_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]; // indexado por getDay()
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// ---------- grilla horaria ----------
const HORA_INI = 0;
const HORA_FIN = 24;
const PX_HORA = 52;
const SNAP_MIN = 15;
const TAP_MOVE_PX = 18; // si el dedo se mueve más que esto, se prioriza el scroll y no se crea tarea
const snap = (min) => Math.round(min / SNAP_MIN) * SNAP_MIN;

const PALETA = ["#2563EB", "#059669", "#DB2777", "#D97706", "#7C3AED", "#0891B2", "#DC2626", "#65A30D"];

// Selector de color reutilizable: paleta fija + rueda del sistema + hexadecimal manual
function SelectorColor({ color, onChange }) {
  const esHexValido = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <>
      <div className="flex gap-2 mt-3 flex-wrap items-center">
        {PALETA.map((col) => (
          <button key={col} onClick={() => onChange(col)}
            className="w-7 h-7 rounded-full transition" style={{ background: col, outline: color === col ? "2px solid #1B2430" : "none", outlineOffset: 2 }} />
        ))}
        <label className="w-7 h-7 rounded-full cursor-pointer relative overflow-hidden" title="Color personalizado"
          style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
            outline: !PALETA.includes(color) && esHexValido ? "2px solid #1B2430" : "none", outlineOffset: 2 }}>
          <input type="color" value={esHexValido ? color : "#000000"} onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="w-6 h-6 rounded-full border border-[#E6E8EC] shrink-0" style={{ background: esHexValido ? color : "transparent" }} />
        <input value={color}
          onChange={(e) => { let v = e.target.value.trim(); if (v && !v.startsWith("#")) v = "#" + v; onChange(v); }}
          placeholder="#2563EB" maxLength={7}
          className="flex-1 bg-white rounded-lg px-3 py-1.5 outline-none text-[14px] border border-[#E6E8EC] font-mono uppercase" />
      </div>
    </>
  );
}

let _id = 100;
const uid = () => `tmp-${Date.now()}-${_id++}`;

// ============================================================
// Capa de datos: Supabase
// ============================================================
const rowToCal = (r) => ({ id: r.id, nombre: r.nombre, color: r.color });
const rowToTarea = (r) => ({
  id: r.id, titulo: r.titulo, descripcion: r.descripcion,
  calendarioId: r.calendario_id,
  proyectoId: r.proyecto_id,
  start: r.inicio ? new Date(r.inicio) : null,
  end: r.fin ? new Date(r.fin) : null,
  completada: r.completada,
});
const tareaToRow = (t) => ({
  titulo: t.titulo,
  descripcion: t.descripcion ?? null,
  calendario_id: t.calendarioId ?? null,
  proyecto_id: t.proyectoId ?? null,
  inicio: t.start ? new Date(t.start).toISOString() : null,
  fin: t.end ? new Date(t.end).toISOString() : null,
  completada: !!t.completada,
});

const rowToProyecto = (r) => ({ id: r.id, nombre: r.nombre, color: r.color });

const rowToPaso = (r) => ({ id: r.id, proyectoId: r.proyecto_id, titulo: r.titulo, hecho: r.hecho, orden: r.orden, tareaId: r.tarea_id });
const pasoToRow = (p) => ({ proyecto_id: p.proyectoId, titulo: p.titulo, hecho: !!p.hecho, orden: p.orden, tarea_id: p.tareaId ?? null });

function useAgenda() {
  const [calendarios, setCalendarios] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [pasos, setPasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [c, t, p, s] = await Promise.all([
          supabase.from("calendarios").select("*").order("created_at"),
          supabase.from("tareas").select("*").order("created_at"),
          supabase.from("proyectos").select("*").order("created_at"),
          supabase.from("pasos").select("*").order("orden"),
        ]);
        if (c.error) throw c.error;
        if (t.error) throw t.error;
        if (p.error) throw p.error;
        if (s.error) throw s.error;
        if (!activo) return;
        setCalendarios(c.data.map(rowToCal));
        setTareas(t.data.map(rowToTarea));
        setProyectos(p.data.map(rowToProyecto));
        setPasos(s.data.map(rowToPaso));
      } catch (e) {
        if (activo) setError(e.message || "No se pudieron cargar los datos");
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  // insert si _nuevo, update si ya existe (optimista)
  const upsertTarea = useCallback(async (t) => {
    if (t._nuevo) {
      const tempId = t.id || uid();
      const { _nuevo, ...sinFlag } = t;
      setTareas((p) => [...p, { ...sinFlag, id: tempId }]);
      const { data, error } = await supabase.from("tareas").insert(tareaToRow(t)).select().single();
      if (error) { setTareas((p) => p.filter((x) => x.id !== tempId)); setError(error.message); return; }
      setTareas((p) => p.map((x) => (x.id === tempId ? rowToTarea(data) : x)));
    } else {
      setTareas((p) => p.map((x) => (x.id === t.id ? t : x)));
      const { error } = await supabase.from("tareas").update(tareaToRow(t)).eq("id", t.id);
      if (error) setError(error.message);
    }
  }, []);

  const deleteTarea = useCallback(async (id) => {
    setTareas((p) => p.filter((x) => x.id !== id));
    const { error } = await supabase.from("tareas").delete().eq("id", id);
    if (error) setError(error.message);
  }, []);

  const upsertCalendario = useCallback(async (c) => {
    if (c.id) {
      setCalendarios((p) => p.map((x) => (x.id === c.id ? c : x)));
      const { error } = await supabase.from("calendarios").update({ nombre: c.nombre, color: c.color }).eq("id", c.id);
      if (error) setError(error.message);
    } else {
      const tempId = uid();
      setCalendarios((p) => [...p, { ...c, id: tempId }]);
      const { data, error } = await supabase.from("calendarios").insert({ nombre: c.nombre, color: c.color }).select().single();
      if (error) { setCalendarios((p) => p.filter((x) => x.id !== tempId)); setError(error.message); return; }
      setCalendarios((p) => p.map((x) => (x.id === tempId ? rowToCal(data) : x)));
    }
  }, []);

  const deleteCalendario = useCallback(async (id) => {
    setCalendarios((p) => p.filter((x) => x.id !== id));
    setTareas((p) => p.map((x) => (x.calendarioId === id ? { ...x, calendarioId: null } : x)));
    const { error } = await supabase.from("calendarios").delete().eq("id", id);
    if (error) setError(error.message);
  }, []);

  // ---------- proyectos ----------
  const upsertProyecto = useCallback(async (pr) => {
    if (pr.id) {
      setProyectos((p) => p.map((x) => (x.id === pr.id ? pr : x)));
      const { error } = await supabase.from("proyectos").update({ nombre: pr.nombre, color: pr.color }).eq("id", pr.id);
      if (error) setError(error.message);
    } else {
      const tempId = uid();
      setProyectos((p) => [...p, { ...pr, id: tempId }]);
      const { data, error } = await supabase.from("proyectos").insert({ nombre: pr.nombre, color: pr.color }).select().single();
      if (error) { setProyectos((p) => p.filter((x) => x.id !== tempId)); setError(error.message); return; }
      setProyectos((p) => p.map((x) => (x.id === tempId ? rowToProyecto(data) : x)));
    }
  }, []);

  const deleteProyecto = useCallback(async (id) => {
    setProyectos((p) => p.filter((x) => x.id !== id));
    setPasos((p) => p.filter((x) => x.proyectoId !== id)); // cascade en la base
    setTareas((p) => p.map((x) => (x.proyectoId === id ? { ...x, proyectoId: null } : x))); // set null en la base
    const { error } = await supabase.from("proyectos").delete().eq("id", id);
    if (error) setError(error.message);
  }, []);

  // ---------- pasos ----------
  const crearPaso = useCallback(async (proyectoId, titulo, ordenSiguiente) => {
    const tempId = uid();
    const nuevo = { id: tempId, proyectoId, titulo, hecho: false, orden: ordenSiguiente, tareaId: null };
    setPasos((p) => [...p, nuevo]);
    const { data, error } = await supabase.from("pasos").insert(pasoToRow(nuevo)).select().single();
    if (error) { setPasos((p) => p.filter((x) => x.id !== tempId)); setError(error.message); return; }
    setPasos((p) => p.map((x) => (x.id === tempId ? rowToPaso(data) : x)));
  }, []);

  const actualizarPaso = useCallback(async (s) => {
    setPasos((p) => p.map((x) => (x.id === s.id ? s : x)));
    const { error } = await supabase.from("pasos").update(pasoToRow(s)).eq("id", s.id);
    if (error) setError(error.message);
  }, []);

  const eliminarPaso = useCallback(async (s) => {
    setPasos((p) => p.filter((x) => x.id !== s.id));
    if (s.tareaId) {
      setTareas((p) => p.filter((x) => x.id !== s.tareaId));
      await supabase.from("tareas").delete().eq("id", s.tareaId);
    }
    const { error } = await supabase.from("pasos").delete().eq("id", s.id);
    if (error) setError(error.message);
  }, []);

  const reordenarPasos = useCallback(async (proyectoId, pasosOrdenados) => {
    const conOrden = pasosOrdenados.map((s, i) => ({ ...s, orden: i }));
    setPasos((p) => [...p.filter((x) => x.proyectoId !== proyectoId), ...conOrden]);
    await Promise.all(conOrden.map((s) => supabase.from("pasos").update({ orden: s.orden }).eq("id", s.id)));
  }, []);

  // crea (o reprograma) la tarea real ligada a un paso, y la deja en Semana
  const agendarPaso = useCallback(async (paso, proyectoId, fecha, hora) => {
    const [h, m] = hora.split(":").map(Number);
    const start = new Date(fecha); start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);

    if (paso.tareaId) {
      setTareas((p) => p.map((x) => (x.id === paso.tareaId ? { ...x, start, end } : x)));
      const { error } = await supabase.from("tareas").update({ inicio: start.toISOString(), fin: end.toISOString() }).eq("id", paso.tareaId);
      if (error) setError(error.message);
      return;
    }
    const filaTarea = tareaToRow({ titulo: paso.titulo, calendarioId: null, proyectoId, start, end, completada: false });
    const { data, error } = await supabase.from("tareas").insert(filaTarea).select().single();
    if (error) { setError(error.message); return; }
    const nuevaTarea = rowToTarea(data);
    setTareas((p) => [...p, nuevaTarea]);
    const pasoActualizado = { ...paso, tareaId: nuevaTarea.id };
    setPasos((p) => p.map((x) => (x.id === paso.id ? pasoActualizado : x)));
    await supabase.from("pasos").update({ tarea_id: nuevaTarea.id }).eq("id", paso.id);
  }, []);

  const desagendarPaso = useCallback(async (paso) => {
    if (!paso.tareaId) return;
    setTareas((p) => p.filter((x) => x.id !== paso.tareaId));
    setPasos((p) => p.map((x) => (x.id === paso.id ? { ...x, tareaId: null } : x)));
    await supabase.from("tareas").delete().eq("id", paso.tareaId);
    await supabase.from("pasos").update({ tarea_id: null }).eq("id", paso.id);
  }, []);

  return {
    calendarios, tareas, proyectos, pasos, loading, error, setError,
    upsertTarea, deleteTarea, upsertCalendario, deleteCalendario,
    upsertProyecto, deleteProyecto, crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso,
  };
}

// ============================================================
export default function Agenda() {
  const [session, setSession] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCargando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (cargando) {
    return (
      <div className="flex h-screen items-center justify-center text-[#9AA1AC]" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (!session) return <Auth />;
  return <AgendaApp onSignOut={() => supabase.auth.signOut()} />;
}

function Auth() {
  const [modo, setModo] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [cargando, setCargando] = useState(false);

  const submit = async () => {
    if (!email.trim() || !pass) return;
    setError(null); setAviso(null); setCargando(true);
    const { data, error } = modo === "login"
      ? await supabase.auth.signInWithPassword({ email, password: pass })
      : await supabase.auth.signUp({ email, password: pass });
    setCargando(false);
    if (error) { setError(error.message); return; }
    if (modo === "signup" && !data.session) setAviso("Cuenta creada. Si pide confirmación, revisá tu email (o desactivá la confirmación en Supabase).");
    // si vuelve una sesión, el gate la detecta y entra solo
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#F4F5F7] px-6" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#E6E8EC] p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9AA1AC]">Agenda</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1B2430] mb-5">{modo === "login" ? "Iniciar sesión" : "Crear cuenta"}</h1>

        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" autoComplete="email"
          className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2.5 outline-none text-[15px] mb-2.5 border border-[#E6E8EC]" />
        <input value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" placeholder="Contraseña" autoComplete={modo === "login" ? "current-password" : "new-password"}
          className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2.5 outline-none text-[15px] border border-[#E6E8EC]" />

        {error && <p className="text-[13px] text-[#DC2626] mt-3">{error}</p>}
        {aviso && <p className="text-[13px] text-[#059669] mt-3">{aviso}</p>}

        <button onClick={submit} disabled={cargando}
          className="mt-4 w-full bg-[#1B2430] text-white rounded-lg py-2.5 text-[15px] font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {cargando && <Loader2 size={16} className="animate-spin" />}
          {modo === "login" ? "Entrar" : "Crear cuenta"}
        </button>

        <button onClick={() => { setModo(modo === "login" ? "signup" : "login"); setError(null); setAviso(null); }}
          className="mt-4 w-full text-center text-[13px] text-[#6B7280]">
          {modo === "login" ? "¿No tenés cuenta? Crear una" : "¿Ya tenés cuenta? Iniciar sesión"}
        </button>
      </div>
    </div>
  );
}

function AgendaApp({ onSignOut }) {
  const hoy = startOfDay(new Date());
  const [vista, setVista] = useState("semana");
  const {
    calendarios, tareas, proyectos, pasos, loading, error, setError,
    upsertTarea, deleteTarea, upsertCalendario, deleteCalendario,
    upsertProyecto, deleteProyecto, crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso,
  } = useAgenda();

  const calById = useMemo(() => Object.fromEntries(calendarios.map((c) => [c.id, c])), [calendarios]);
  const proyById = useMemo(() => Object.fromEntries(proyectos.map((p) => [p.id, p])), [proyectos]);
  const colorDe = (t) => calById[t.calendarioId]?.color || proyById[t.proyectoId]?.color || "#94A3B8";

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      className="flex flex-col h-screen w-full bg-[#F4F5F7] text-[#1B2430] mx-auto max-w-md border-x border-[#E6E8EC]">
      <Header vista={vista} onSignOut={onSignOut} />
      {error && (
        <div className="flex items-center gap-2 bg-[#FEF2F2] text-[#B91C1C] text-[13px] px-4 py-2 border-b border-[#FECACA]">
          <AlertCircle size={16} /><span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-[#9AA1AC]">
            <Loader2 size={22} className="animate-spin" /><span className="ml-2 text-[14px]">Cargando…</span>
          </div>
        ) : (
          <>
            {vista === "bandeja" && <Bandeja {...{ tareas, calendarios, proyectos, upsertCalendario, deleteCalendario, colorDe, upsert: upsertTarea, borrar: deleteTarea }} />}
            {vista === "hoy" && <Hoy {...{ tareas, calById, calendarios, proyectos, colorDe, hoy, upsert: upsertTarea, borrar: deleteTarea }} />}
            {vista === "semana" && <Semana {...{ tareas, calById, calendarios, proyectos, colorDe, upsert: upsertTarea, borrar: deleteTarea, hoy }} />}
            {vista === "proyectos" && (
              <Proyectos {...{ proyectos, pasos, upsertProyecto, deleteProyecto, crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso, hoy }} />
            )}
          </>
        )}
      </div>
      <Tabs vista={vista} setVista={setVista} />
    </div>
  );
}

function Header({ vista, onSignOut }) {
  const titulos = { bandeja: "Bandeja de entrada", hoy: "Hoy", semana: "Semana", proyectos: "Proyectos" };
  return (
    <div className="px-4 pt-4 pb-3 bg-white border-b border-[#E6E8EC] flex items-end justify-between">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9AA1AC]">Agenda</p>
        <h1 className="text-2xl font-semibold tracking-tight">{titulos[vista]}</h1>
      </div>
      {onSignOut && (
        <button onClick={onSignOut} className="text-[#9AA1AC] hover:text-[#1B2430] transition p-1.5" title="Salir">
          <LogOut size={20} />
        </button>
      )}
    </div>
  );
}

function Tabs({ vista, setVista }) {
  const items = [
    { id: "bandeja", label: "Bandeja", icon: Inbox },
    { id: "hoy", label: "Hoy", icon: Sun },
    { id: "semana", label: "Semana", icon: CalendarDays },
    { id: "proyectos", label: "Proyectos", icon: FolderKanban },
  ];
  return (
    <nav className="flex bg-white border-t border-[#E6E8EC] pb-1">
      {items.map(({ id, label, icon: Icon }) => {
        const on = vista === id;
        return (
          <button key={id} onClick={() => setVista(id)}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors"
            style={{ color: on ? "#E8743B" : "#9AA1AC" }}>
            <Icon size={22} strokeWidth={on ? 2.4 : 1.8} />
            <span className="text-[11px] font-medium" style={{ color: on ? "#1B2430" : "#9AA1AC" }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ============================ BANDEJA ============================
function Bandeja({ tareas, calendarios, proyectos, upsertCalendario, deleteCalendario, colorDe, upsert, borrar }) {
  const [texto, setTexto] = useState("");
  const [calSel, setCalSel] = useState(calendarios[0]?.id || null);
  const [gestion, setGestion] = useState(false);
  const [editar, setEditar] = useState(null);
  const inbox = tareas.filter((t) => !t.start);

  const agregar = () => {
    if (!texto.trim()) return;
    upsert({ id: uid(), titulo: texto.trim(), calendarioId: calSel, start: null, end: null, completada: false, _nuevo: true });
    setTexto("");
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {/* captura rápida */}
      <div className="bg-white rounded-2xl border border-[#E6E8EC] p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()}
            placeholder="Agregar tarea…" className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#B6BCC6]" />
          <button onClick={agregar} className="shrink-0 w-9 h-9 rounded-full bg-[#1B2430] text-white flex items-center justify-center active:scale-95 transition">
            <Plus size={20} />
          </button>
        </div>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {calendarios.map((c) => (
            <button key={c.id} onClick={() => setCalSel(c.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition"
              style={{ borderColor: calSel === c.id ? c.color : "#E6E8EC", background: calSel === c.id ? c.color + "1A" : "transparent", color: calSel === c.id ? c.color : "#6B7280" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.nombre}
            </button>
          ))}
        </div>
      </div>

      {/* lista inbox */}
      <div className="mt-5 flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.14em] text-[#9AA1AC]">Sin programar · {inbox.length}</p>
        <button onClick={() => setGestion(true)} className="text-[12px] font-medium text-[#E8743B]">Editar calendarios</button>
      </div>
      <div className="mt-2 space-y-2">
        {inbox.length === 0 && <p className="text-[14px] text-[#9AA1AC] py-6 text-center">Bandeja vacía. Capturá lo que tengas en la cabeza.</p>}
        {inbox.map((t) => (
          <div key={t.id} className="group flex items-center gap-3 bg-white rounded-xl border border-[#E6E8EC] px-3 py-2.5">
            <span className="w-1.5 h-7 rounded-full shrink-0" style={{ background: colorDe(t) }} />
            <button onClick={() => setEditar({ ...t })} className="flex-1 text-left text-[15px]">{t.titulo}</button>
            <button onClick={() => borrar(t.id)} className="text-[#C4C9D1] hover:text-[#DC2626] transition"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-[#9AA1AC] mt-4 text-center leading-relaxed">
        Para programar una tarea, arrastrala en la vista <b>Semana</b> (o creala directo ahí).
      </p>

      {gestion && (
        <GestionCalendarios
          calendarios={calendarios}
          onSave={upsertCalendario}
          onDelete={(id) => { deleteCalendario(id); if (calSel === id) setCalSel(null); }}
          onClose={() => setGestion(false)}
        />
      )}
      {editar && <EditorTarea {...{ editar, setEditar, calendarios, proyectos, upsert, onDelete: borrar }} />}
    </div>
  );
}

function GestionCalendarios({ calendarios, onSave, onDelete, onClose }) {
  const [edit, setEdit] = useState(null); // {id?, nombre, color}
  const guardar = () => {
    if (!edit.nombre.trim()) return;
    onSave(edit);
    setEdit(null);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl p-5 max-h-[80%] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Calendarios</h2>
          <button onClick={onClose}><X size={22} className="text-[#9AA1AC]" /></button>
        </div>

        <div className="space-y-2">
          {calendarios.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#E6E8EC]">
              <span className="w-3.5 h-3.5 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 text-[15px]">{c.nombre}</span>
              <button onClick={() => setEdit({ ...c })} className="text-[#9AA1AC] hover:text-[#1B2430]"><Pencil size={16} /></button>
              <button onClick={() => onDelete(c.id)} className="text-[#9AA1AC] hover:text-[#DC2626]"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>

        {edit ? (
          <div className="mt-4 p-3 rounded-xl bg-[#F4F5F7]">
            <input autoFocus value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
              placeholder="Nombre del calendario" className="w-full bg-white rounded-lg px-3 py-2 outline-none text-[15px] border border-[#E6E8EC]" />
            <SelectorColor color={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} />
            <div className="flex gap-2 mt-4">
              <button onClick={guardar} className="flex-1 bg-[#1B2430] text-white rounded-lg py-2 text-[15px] font-medium">Guardar</button>
              <button onClick={() => setEdit(null)} className="px-4 bg-white border border-[#E6E8EC] rounded-lg py-2 text-[15px]">Cancelar</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEdit({ nombre: "", color: PALETA[0] })}
            className="mt-4 w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#D7DBE1] rounded-xl py-2.5 text-[#6B7280] text-[14px] font-medium">
            <Plus size={18} /> Nuevo calendario
          </button>
        )}
      </div>
    </div>
  );
}

// ============================ HOY ============================
function Hoy({ tareas, calById, calendarios, proyectos, colorDe, hoy, upsert, borrar }) {
  const delDia = tareas.filter((t) => t.start && sameDay(t.start, hoy)).sort((a, b) => a.start - b.start);
  const [editar, setEditar] = useState(null);
  const toggle = (t) => upsert({ ...t, completada: !t.completada });
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <p className="text-[13px] text-[#6B7280] mb-3">{hoy.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</p>
      {delDia.length === 0 && <p className="text-[14px] text-[#9AA1AC] py-10 text-center">Nada programado para hoy.</p>}
      <div className="space-y-2">
        {delDia.map((t) => (
          <div key={t.id} className="flex items-center gap-3 bg-white rounded-xl border border-[#E6E8EC] px-3 py-3">
            <button onClick={() => toggle(t)} className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition"
              style={{ borderColor: colorDe(t), background: t.completada ? colorDe(t) : "transparent" }}>
              {t.completada && <Check size={15} className="text-white" strokeWidth={3} />}
            </button>
            <button onClick={() => setEditar({ ...t })} className="flex-1 text-left">
              <p className={"text-[15px] " + (t.completada ? "line-through text-[#9AA1AC]" : "")}>{t.titulo}</p>
              <p className="text-[12px] text-[#9AA1AC]">{fmtHora(t.start)}–{fmtHora(t.end)} · {calById[t.calendarioId]?.nombre || "Sin calendario"}</p>
            </button>
            <span className="w-1.5 h-9 rounded-full" style={{ background: colorDe(t) }} />
          </div>
        ))}
      </div>
      {editar && <EditorTarea {...{ editar, setEditar, calendarios, proyectos, upsert, onDelete: borrar }} />}
    </div>
  );
}

// ============================ SEMANA (grilla con drag) ============================
function Semana({ tareas, calById, calendarios, proyectos, colorDe, upsert, borrar, hoy }) {
  const [numDias, setNumDias] = useState(7);
  const [ancla, setAncla] = useState(startOfWeek(new Date()));
  const dias = useMemo(() => Array.from({ length: numDias }, (_, i) => addDays(ancla, i)), [ancla, numDias]);
  const cambiarModo = (n) => { setNumDias(n); setAncla(n === 7 ? startOfWeek(new Date()) : startOfDay(new Date())); };
  const horas = Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => HORA_INI + i);
  const altoGrilla = (HORA_FIN - HORA_INI) * PX_HORA;

  const gridRef = useRef(null);
  const tapRef = useRef(null); // tap pendiente sobre la grilla vacía (se resuelve como tap o se cancela como scroll)
  const [drag, setDrag] = useState(null);
  const [draftDrag, setDraftDrag] = useState(null); // arrastre de las manijas del rectángulo de tarea nueva
  const [editar, setEditar] = useState(null);
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => { const i = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()); }, 60000); return () => clearInterval(i); }, []);

  const progr = tareas.filter((t) => t.start);
  const inbox = tareas.filter((t) => !t.start);

  const yToMin = useCallback((clientY) => {
    const r = gridRef.current.getBoundingClientRect();
    let min = ((clientY - r.top) / PX_HORA) * 60 + HORA_INI * 60;
    return Math.max(HORA_INI * 60, Math.min(HORA_FIN * 60, snap(min)));
  }, []);
  const xToDia = useCallback((clientX) => {
    const r = gridRef.current.getBoundingClientRect();
    const colW = r.width / numDias;
    return Math.max(0, Math.min(numDias - 1, Math.floor((clientX - r.left) / colW)));
  }, [numDias]);

  const aplicar = useCallback((d, clientX, clientY) => {
    const min = yToMin(clientY);
    if (d.modo === "resize") return { ...d, endMin: Math.max(min, d.startMin + SNAP_MIN) };
    if (d.modo === "mover") {
      const dur = d.endMin - d.startMin;
      let ns = min - d.offsetMin;
      ns = Math.max(HORA_INI * 60, Math.min(HORA_FIN * 60 - dur, snap(ns)));
      return { ...d, startMin: ns, endMin: ns + dur, diaIdx: xToDia(clientX) };
    }
    return d;
  }, [yToMin, xToDia]);

  // arrastre de las manijas del rectángulo de "tarea nueva" (top = inicio, bottom = fin, mover = todo el bloque)
  const aplicarDraft = useCallback((d, clientX, clientY) => {
    const min = yToMin(clientY);
    if (d.modo === "top") return { ...d, startMin: Math.min(min, d.endMin - SNAP_MIN) };
    if (d.modo === "bottom") return { ...d, endMin: Math.max(min, d.startMin + SNAP_MIN) };
    if (d.modo === "mover") {
      const dur = d.endMin - d.startMin;
      let ns = min - d.offsetMin;
      ns = Math.max(HORA_INI * 60, Math.min(HORA_FIN * 60 - dur, snap(ns)));
      return { ...d, startMin: ns, endMin: ns + dur, diaIdx: xToDia(clientX) };
    }
    return d;
  }, [yToMin, xToDia]);

  // tap sobre la grilla vacía: no captura el puntero, así el scroll nativo manda.
  // si al soltar el dedo casi no se movió, se interpreta como tap y abre la tarea nueva.
  const onColDown = (e, diaIdx) => {
    if (drag || draftDrag || e.target.dataset.bloque) return;
    tapRef.current = { diaIdx, x: e.clientX, y: e.clientY, startMin: yToMin(e.clientY), pointerId: e.pointerId, moved: false };
  };
  const onDownBloque = (e, t, modo) => {
    e.stopPropagation();
    gridRef.current.setPointerCapture(e.pointerId);
    const sMin = t.start.getHours() * 60 + t.start.getMinutes();
    const eMin = t.end.getHours() * 60 + t.end.getMinutes();
    const diaIdx = dias.findIndex((d) => sameDay(d, t.start));
    setDrag({ modo, id: t.id, diaIdx, startMin: sMin, endMin: eMin, offsetMin: modo === "mover" ? yToMin(e.clientY) - sMin : 0 });
  };
  // manijas del rectángulo de tarea nueva (mientras editar?._nuevo está activo)
  const onDownHandle = (e, modo) => {
    e.stopPropagation();
    gridRef.current.setPointerCapture(e.pointerId);
    const sMin = editar.start.getHours() * 60 + editar.start.getMinutes();
    const eMin = editar.end.getHours() * 60 + editar.end.getMinutes();
    const diaIdx = dias.findIndex((d) => sameDay(d, editar.start));
    setDraftDrag({ modo, diaIdx, startMin: sMin, endMin: eMin, offsetMin: modo === "mover" ? yToMin(e.clientY) - sMin : 0 });
  };
  const onMove = (e) => {
    if (drag) setDrag((d) => ({ ...aplicar(d, e.clientX, e.clientY), px: e.clientX, py: e.clientY }));
    if (draftDrag) setDraftDrag((d) => ({ ...aplicarDraft(d, e.clientX, e.clientY), px: e.clientX, py: e.clientY }));
    const tap = tapRef.current;
    if (tap && !tap.moved) {
      if (Math.abs(e.clientX - tap.x) > TAP_MOVE_PX || Math.abs(e.clientY - tap.y) > TAP_MOVE_PX) tap.moved = true;
    }
  };
  const onUp = () => {
    if (drag) {
      if (drag.modo === "programar") { setDrag(null); tapRef.current = null; return; }
      const base = dias[drag.diaIdx];
      const mk = (min) => { const d = new Date(base); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d; };
      const orig = tareas.find((t) => t.id === drag.id);
      upsert({ ...orig, start: mk(drag.startMin), end: mk(drag.endMin) });
      setDrag(null);
      tapRef.current = null;
      return;
    }
    if (draftDrag) {
      const base = dias[draftDrag.diaIdx];
      const mk = (min) => { const d = new Date(base); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d; };
      setEditar((ed) => (ed ? { ...ed, start: mk(draftDrag.startMin), end: mk(draftDrag.endMin) } : ed));
      setDraftDrag(null);
      tapRef.current = null;
      return;
    }
    const tap = tapRef.current;
    if (tap && !tap.moved) {
      const base = dias[tap.diaIdx];
      const mk = (min) => { const d = new Date(base); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d; };
      const finMin = Math.min(tap.startMin + 60, HORA_FIN * 60 - 1);
      setEditar({ id: uid(), titulo: "", calendarioId: calendarios[0]?.id || null, start: mk(tap.startMin), end: mk(finMin), completada: false, _nuevo: true });
    }
    tapRef.current = null;
  };

  // arrastrar desde la bandeja a la grilla
  const onChipDown = (e, t) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ modo: "programar", id: t.id, diaIdx: 0, startMin: HORA_INI * 60, endMin: HORA_INI * 60 + 60, sobreGrilla: false, px: e.clientX, py: e.clientY });
  };
  const onChipMove = (e) => {
    if (!drag || drag.modo !== "programar") return;
    const r = gridRef.current.getBoundingClientRect();
    const dentro = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (dentro) {
      const s = yToMin(e.clientY);
      setDrag((d) => ({ ...d, sobreGrilla: true, diaIdx: xToDia(e.clientX), startMin: s, endMin: Math.min(HORA_FIN * 60, s + 60), px: e.clientX, py: e.clientY }));
    } else {
      setDrag((d) => ({ ...d, sobreGrilla: false, px: e.clientX, py: e.clientY }));
    }
  };
  const onChipUp = () => {
    if (!drag || drag.modo !== "programar") return;
    if (drag.sobreGrilla) {
      const base = dias[drag.diaIdx];
      const mk = (min) => { const d = new Date(base); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d; };
      const orig = tareas.find((t) => t.id === drag.id);
      if (orig) upsert({ ...orig, start: mk(drag.startMin), end: mk(drag.endMin) });
    }
    setDrag(null);
  };

  const minToTop = (m) => ((m - HORA_INI * 60) / 60) * PX_HORA;

  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) {
      const h = Math.max(HORA_INI, new Date().getHours() - 1);
      scrollRef.current.scrollTop = minToTop(h * 60);
    }
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* selector de vista + nav */}
      <div className="bg-white border-b border-[#E6E8EC]">
        <div className="flex gap-1 px-3 pt-2">
          {[{ n: 1, l: "Hoy" }, { n: 3, l: "3 días" }, { n: 7, l: "Semana" }].map(({ n, l }) => {
            const on = numDias === n;
            return (
              <button key={n} onClick={() => cambiarModo(n)}
                className="flex-1 py-1.5 rounded-lg text-[13px] font-medium transition"
                style={{ background: on ? "#1B2430" : "#F4F5F7", color: on ? "white" : "#6B7280" }}>{l}</button>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-4 py-2">
          <button onClick={() => setAncla(addDays(ancla, -numDias))} className="p-1.5 text-[#6B7280]"><ChevronLeft size={20} /></button>
          <p className="text-[14px] font-medium">
            {numDias === 1
              ? ancla.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
              : `${ancla.getDate()} ${MESES[ancla.getMonth()].slice(0, 3)} – ${addDays(ancla, numDias - 1).getDate()} ${MESES[addDays(ancla, numDias - 1).getMonth()].slice(0, 3)}`}
          </p>
          <button onClick={() => setAncla(addDays(ancla, numDias))} className="p-1.5 text-[#6B7280]"><ChevronRight size={20} /></button>
        </div>
      </div>

      {/* encabezado días */}
      <div className="flex bg-white border-b border-[#E6E8EC] pl-10">
        {dias.map((d, i) => {
          const esHoy = sameDay(d, hoy);
          return (
            <div key={i} className="flex-1 text-center py-1.5">
              <p className="text-[10px] uppercase text-[#9AA1AC]">{DIA_CORTO[d.getDay()]}</p>
              <p className="text-[14px] font-semibold mx-auto w-7 h-7 leading-7 rounded-full"
                style={{ background: esHoy ? "#E8743B" : "transparent", color: esHoy ? "white" : "#1B2430" }}>{d.getDate()}</p>
            </div>
          );
        })}
      </div>

      {/* grilla scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex" style={{ height: altoGrilla }}>
          {/* columna horas */}
          <div className="w-10 shrink-0 relative">
            {horas.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-[#B6BCC6]" style={{ top: minToTop(h * 60) }}>{h}:00</div>
            ))}
          </div>
          {/* área de columnas + drag */}
          <div ref={gridRef} className="flex-1 relative" style={{ touchAction: drag ? "none" : "auto" }} onPointerMove={onMove} onPointerUp={onUp}>
            {horas.map((h) => (
              <div key={h} className="absolute left-0 right-0 border-t border-[#EDEFF2]" style={{ top: minToTop(h * 60) }} />
            ))}
            <div className="absolute inset-0 flex">
              {dias.map((d, i) => (
                <div key={i} className="flex-1 border-l border-[#EDEFF2] relative"
                  style={{ touchAction: "pan-y" }} onPointerDown={(e) => onColDown(e, i)} />
              ))}
            </div>
            {dias.some((d) => sameDay(d, hoy)) && nowMin >= HORA_INI * 60 && nowMin <= HORA_FIN * 60 && (
              <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: minToTop(nowMin) }}>
                <div className="h-[2px] bg-[#EF4444]" />
              </div>
            )}
            {progr.map((t) => {
              const di = dias.findIndex((d) => sameDay(d, t.start));
              if (di < 0) return null;
              const sMin = t.start.getHours() * 60 + t.start.getMinutes();
              const eMin = t.end.getHours() * 60 + t.end.getMinutes();
              const arrastrando = drag?.id === t.id;
              const top = minToTop(arrastrando ? drag.startMin : sMin);
              const h = ((arrastrando ? drag.endMin - drag.startMin : eMin - sMin) / 60) * PX_HORA;
              const colW = 100 / numDias;
              const idx = arrastrando ? drag.diaIdx : di;
              const col = colorDe(t);
              return (
                <div key={t.id} data-bloque="1" onPointerDown={(e) => onDownBloque(e, t, "mover")}
                  onClick={() => !drag && setEditar({ ...t })}
                  className="absolute rounded-lg px-1.5 py-1 overflow-hidden shadow-sm select-none"
                  style={{ top, height: Math.max(h - 2, 16), left: `calc(${idx * colW}% + 2px)`, width: `calc(${colW}% - 4px)`,
                    background: col + "26", borderLeft: `3px solid ${col}`, touchAction: "none", zIndex: arrastrando ? 30 : 10, opacity: t.completada ? 0.55 : 1 }}>
                  <p className="text-[11px] font-semibold leading-tight truncate" style={{ color: col }}>{t.titulo}</p>
                  <p className="text-[10px] leading-tight" style={{ color: col }}>{arrastrando ? `${minAHora(drag.startMin)}–${minAHora(drag.endMin)}` : fmtHora(t.start)}</p>
                  <div data-bloque="1" onPointerDown={(e) => onDownBloque(e, t, "resize")}
                    className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize" />
                </div>
              );
            })}
            {drag?.modo === "programar" && drag.sobreGrilla && (
              <div className="absolute rounded-lg pointer-events-none border-2 border-dashed flex items-center justify-center"
                style={{ top: minToTop(drag.startMin), height: PX_HORA,
                  left: `calc(${drag.diaIdx * (100 / numDias)}% + 2px)`, width: `calc(${100 / numDias}% - 4px)`, borderColor: "#E8743B", background: "#E8743B22", zIndex: 25 }}>
                <span className="text-[10px] font-semibold text-[#E8743B]">{minAHora(drag.startMin)}</span>
              </div>
            )}
            {/* rectángulo de selección de la tarea nueva, con manijas arriba/abajo (estilo Google Calendar) */}
            {editar?._nuevo && (() => {
              const enVivo = !!draftDrag;
              const diaIdx = enVivo ? draftDrag.diaIdx : dias.findIndex((d) => sameDay(d, editar.start));
              if (diaIdx < 0) return null;
              const sMin = enVivo ? draftDrag.startMin : editar.start.getHours() * 60 + editar.start.getMinutes();
              const eMin = enVivo ? draftDrag.endMin : editar.end.getHours() * 60 + editar.end.getMinutes();
              const colW = 100 / numDias;
              const col = calendarios.find((c) => c.id === editar.calendarioId)?.color || "#2563EB";
              return (
                <div data-bloque="1" onPointerDown={(e) => onDownHandle(e, "mover")}
                  className="absolute rounded-lg select-none"
                  style={{ top: minToTop(sMin), height: Math.max(((eMin - sMin) / 60) * PX_HORA, 18),
                    left: `calc(${diaIdx * colW}% + 2px)`, width: `calc(${colW}% - 4px)`,
                    border: `2px solid ${col}`, background: col + "33", zIndex: 28, touchAction: "none" }}>
                  <div data-bloque="1" onPointerDown={(e) => onDownHandle(e, "top")}
                    className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white shadow"
                    style={{ border: `2px solid ${col}`, touchAction: "none" }} />
                  <div data-bloque="1" onPointerDown={(e) => onDownHandle(e, "bottom")}
                    className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white shadow"
                    style={{ border: `2px solid ${col}`, touchAction: "none" }} />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* bandeja: tareas sin programar — arrastrá a la grilla */}
      {inbox.length > 0 && (
        <div className="bg-white border-t border-[#E6E8EC] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#9AA1AC] mb-1.5">Sin programar · arrastrá a la grilla</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {inbox.map((t) => {
              const col = colorDe(t);
              const tomada = drag?.modo === "programar" && drag.id === t.id;
              return (
                <button key={t.id} onPointerDown={(e) => onChipDown(e, t)} onPointerMove={onChipMove} onPointerUp={onChipUp}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-medium select-none"
                  style={{ borderColor: col, background: col + "14", color: col, touchAction: "none", opacity: tomada ? 0.4 : 1 }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: col }} />{t.titulo}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* cartelito de hora en vivo siguiendo al dedo (mover/resize/crear) */}
      {drag && drag.modo !== "programar" && drag.px != null && (
        <div className="fixed pointer-events-none z-50 px-2 py-1 rounded-lg text-[12px] font-semibold shadow-lg"
          style={{ left: drag.px + 12, top: drag.py - 30, background: "#1B2430", color: "white" }}>
          {minAHora(drag.startMin)}–{minAHora(drag.endMin)}
        </div>
      )}
      {draftDrag && draftDrag.px != null && (
        <div className="fixed pointer-events-none z-50 px-2 py-1 rounded-lg text-[12px] font-semibold shadow-lg"
          style={{ left: draftDrag.px + 12, top: draftDrag.py - 30, background: "#1B2430", color: "white" }}>
          {minAHora(draftDrag.startMin)}–{minAHora(draftDrag.endMin)}
        </div>
      )}

      {/* fantasma que sigue al dedo mientras se arrastra una chip */}
      {drag?.modo === "programar" && drag.px != null && (
        <div className="fixed pointer-events-none z-50 px-2 py-1 rounded-lg text-[12px] font-medium shadow-lg"
          style={{ left: drag.px + 8, top: drag.py - 16, background: "#1B2430", color: "white" }}>
          {tareas.find((t) => t.id === drag.id)?.titulo}
        </div>
      )}

      {editar && <EditorTarea {...{ editar, setEditar, calendarios, proyectos, upsert, onDelete: borrar }} />}
    </div>
  );
}

function EditorTarea({ editar, setEditar, calendarios, proyectos, upsert, onDelete }) {
  const [t, setT] = useState(editar);
  const [expandido, setExpandido] = useState(false); // arranca chico abajo, como Google Calendar; se expande recién al tocarlo
  const [tecladoOk, setTecladoOk] = useState(false); // y el teclado recién se habilita cuando el usuario toca el campo a propósito
  const tituloRef = useRef(null);
  const programada = !!t.start;
  const proyecto = proyectos?.find((p) => p.id === t.proyectoId);
  const colorPeek = calendarios.find((c) => c.id === t.calendarioId)?.color || proyecto?.color || "#94A3B8";
  const setHora = (campo, valor) => {
    const [h, m] = valor.split(":").map(Number);
    const d = new Date(t[campo]); d.setHours(h, m, 0, 0); setT({ ...t, [campo]: d });
  };
  const guardar = () => { upsert(t); setEditar(null); };
  const eliminar = () => { onDelete?.(t.id); setEditar(null); };
  const valHora = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const habilitarTeclado = () => {
    if (tecladoOk) return;
    setTecladoOk(true);
    requestAnimationFrame(() => tituloRef.current?.focus());
  };
  // si el usuario ajustó el horario arrastrando el rectángulo en la grilla, se refleja acá
  useEffect(() => {
    setT((prev) => (prev.start?.getTime() === editar.start?.getTime() && prev.end?.getTime() === editar.end?.getTime()
      ? prev : { ...prev, start: editar.start, end: editar.end }));
  }, [editar.start, editar.end]);

  return (
    // pointer-events-none en el wrapper: mientras está "peek" la grilla de atrás sigue siendo arrastrable
    <div className="fixed inset-0 z-40 flex items-end justify-center pointer-events-none">
      {expandido && <div className="absolute inset-0 bg-black/30 pointer-events-auto" onClick={() => setEditar(null)} />}
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden transition-[max-height] duration-300 ease-out pointer-events-auto"
        style={{ maxHeight: expandido ? 640 : 96 }} onClick={(e) => e.stopPropagation()}>
        {!expandido ? (
          // ---- estado "peek": solo lo esencial, se expande al tocarlo ----
          <button onClick={() => setExpandido(true)} className="w-full px-5 pt-2.5 pb-4 flex flex-col items-center text-left active:bg-[#FAFAFB] transition">
            <ChevronUp size={16} className="text-[#C4C9D1] mb-1.5" />
            <div className="w-full flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorPeek }} />
              <span className={"text-[16px] " + (t.titulo ? "text-[#1B2430]" : "text-[#9AA1AC]")}>{t.titulo || "(Sin título)"}</span>
            </div>
            {programada && <span className="text-[12px] text-[#9AA1AC] mt-1 pl-5 self-start">{fmtHora(t.start)}–{fmtHora(t.end)}</span>}
          </button>
        ) : (
          // ---- estado expandido: formulario completo ----
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editar._nuevo ? "Nueva tarea" : "Editar tarea"}</h2>
              <button onClick={() => setEditar(null)}><X size={22} className="text-[#9AA1AC]" /></button>
            </div>
            <input ref={tituloRef} value={t.titulo} onChange={(e) => setT({ ...t, titulo: e.target.value })}
              onPointerDown={habilitarTeclado} inputMode={tecladoOk ? "text" : "none"} placeholder="(Sin título)"
              className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2.5 outline-none text-[16px]" />
            {proyecto && (
              <div className="flex items-center gap-1.5 mt-2 text-[12px]" style={{ color: proyecto.color }}>
                <FolderKanban size={13} /> Paso de «{proyecto.nombre}» · se edita desde Proyectos
              </div>
            )}
            {programada ? (
              <div className="flex gap-3 mt-3">
                <label className="flex-1 text-[12px] text-[#6B7280]">Desde
                  <input type="time" value={valHora(t.start)} onChange={(e) => setHora("start", e.target.value)} className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2 mt-1 text-[15px]" /></label>
                <label className="flex-1 text-[12px] text-[#6B7280]">Hasta
                  <input type="time" value={valHora(t.end)} onChange={(e) => setHora("end", e.target.value)} className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2 mt-1 text-[15px]" /></label>
              </div>
            ) : (
              <p className="text-[12px] text-[#9AA1AC] mt-3">Sin horario · arrastrala a la grilla en Semana para programarla.</p>
            )}
            <p className="text-[12px] text-[#6B7280] mt-3 mb-1.5">Calendario</p>
            <div className="flex gap-1.5 flex-wrap">
              {calendarios.map((c) => (
                <button key={c.id} onClick={() => setT({ ...t, calendarioId: c.id })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium border"
                  style={{ borderColor: t.calendarioId === c.id ? c.color : "#E6E8EC", background: t.calendarioId === c.id ? c.color + "1A" : "transparent", color: t.calendarioId === c.id ? c.color : "#6B7280" }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.nombre}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={guardar} className="flex-1 bg-[#1B2430] text-white rounded-lg py-2.5 text-[15px] font-medium">Guardar</button>
              {onDelete && !editar._nuevo && (
                <button onClick={eliminar} className="px-4 flex items-center justify-center gap-1.5 border border-[#FECACA] text-[#DC2626] rounded-lg py-2.5 text-[15px] font-medium">
                  <Trash2 size={17} /> Eliminar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================ PROYECTOS ============================
function Proyectos({ proyectos, pasos, upsertProyecto, deleteProyecto, crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso, hoy }) {
  const [abierto, setAbierto] = useState(null);
  const proyecto = proyectos.find((p) => p.id === abierto);

  if (proyecto) {
    const pasosDelProyecto = pasos.filter((s) => s.proyectoId === proyecto.id).sort((a, b) => a.orden - b.orden);
    return (
      <DetalleProyecto
        proyecto={proyecto}
        pasos={pasosDelProyecto}
        onVolver={() => setAbierto(null)}
        {...{ crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso, hoy }}
      />
    );
  }
  return <ListaProyectos {...{ proyectos, pasos, upsertProyecto, deleteProyecto }} onAbrir={setAbierto} />;
}

function ListaProyectos({ proyectos, pasos, upsertProyecto, deleteProyecto, onAbrir }) {
  const [nuevo, setNuevo] = useState(false);
  const [editId, setEditId] = useState(null); // id del proyecto en edición inline
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState(PALETA[0]);

  const abrirCrear = () => { setNuevo(true); setEditId(null); setNombre(""); setColor(PALETA[0]); };
  const abrirEditar = (p) => { setEditId(p.id); setNuevo(false); setNombre(p.nombre); setColor(p.color); };
  const cerrar = () => { setNuevo(false); setEditId(null); };
  const guardar = () => {
    if (!nombre.trim()) return;
    upsertProyecto(editId ? { id: editId, nombre: nombre.trim(), color } : { nombre: nombre.trim(), color });
    cerrar();
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {proyectos.length === 0 && !nuevo && (
        <p className="text-[14px] text-[#9AA1AC] py-10 text-center">Sin proyectos todavía. Creá uno para empezar a desglosarlo en pasos.</p>
      )}
      <div className="space-y-3">
        {proyectos.map((p) => {
          const propios = pasos.filter((s) => s.proyectoId === p.id);
          const hechos = propios.filter((s) => s.hecho).length;
          const pct = propios.length ? Math.round((hechos / propios.length) * 100) : 0;
          const enEdicion = editId === p.id;
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-[#E6E8EC] shadow-sm overflow-hidden">
              <div className="flex items-center">
                <button onClick={() => onAbrir(p.id)} className="flex-1 text-left p-4 active:bg-[#FAFAFB] transition">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="flex-1 text-[16px] font-semibold">{p.nombre}</span>
                    <span className="text-[12px] text-[#9AA1AC]">{hechos}/{propios.length}</span>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-[#EDEFF2] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} />
                  </div>
                </button>
                <button onClick={() => (enEdicion ? cerrar() : abrirEditar(p))} className="p-3 text-[#9AA1AC] hover:text-[#1B2430]"><Pencil size={16} /></button>
                <button onClick={() => deleteProyecto(p.id)} className="p-3 pr-4 text-[#9AA1AC] hover:text-[#DC2626]"><Trash2 size={16} /></button>
              </div>
              {enEdicion && (
                <div className="px-4 pb-4 pt-1 border-t border-[#E6E8EC] bg-[#FAFAFB]">
                  <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)}
                    className="w-full bg-white rounded-lg px-3 py-2 outline-none text-[15px] border border-[#E6E8EC] mt-3" />
                  <SelectorColor color={color} onChange={setColor} />
                  <div className="flex gap-2 mt-3">
                    <button onClick={guardar} className="flex-1 bg-[#1B2430] text-white rounded-lg py-2 text-[14px] font-medium">Guardar</button>
                    <button onClick={cerrar} className="px-4 bg-white border border-[#E6E8EC] rounded-lg py-2 text-[14px]">Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {nuevo ? (
          <div className="bg-white rounded-2xl border border-[#E6E8EC] p-4">
            <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && guardar()}
              placeholder="Nombre del proyecto" className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2 outline-none text-[15px]" />
            <SelectorColor color={color} onChange={setColor} />
            <div className="flex gap-2 mt-4">
              <button onClick={guardar} className="flex-1 bg-[#1B2430] text-white rounded-lg py-2 text-[15px] font-medium">Crear</button>
              <button onClick={cerrar} className="px-4 bg-white border border-[#E6E8EC] rounded-lg py-2 text-[15px]">Cancelar</button>
            </div>
          </div>
        ) : (
          <button onClick={abrirCrear}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#D7DBE1] rounded-2xl py-3.5 text-[#6B7280] text-[14px] font-medium">
            <Plus size={18} /> Nuevo proyecto
          </button>
        )}
      </div>
    </div>
  );
}

function DetalleProyecto({ proyecto, pasos, onVolver, crearPaso, actualizarPaso, eliminarPaso, reordenarPasos, agendarPaso, desagendarPaso, hoy }) {
  const [texto, setTexto] = useState("");
  const [agendar, setAgendar] = useState(null);
  const [pasosLocal, setPasosLocal] = useState(pasos);
  const [dragId, setDragId] = useState(null);
  const rowRefs = useRef({});

  // resincroniza con la base salvo mientras se está arrastrando
  useEffect(() => { if (!dragId) setPasosLocal(pasos); }, [pasos, dragId]);

  const agregar = () => {
    if (!texto.trim()) return;
    crearPaso(proyecto.id, texto.trim(), pasosLocal.length);
    setTexto("");
  };

  const onHandleDown = (e, id) => { e.currentTarget.setPointerCapture(e.pointerId); setDragId(id); };
  const onHandleMove = (e) => {
    if (!dragId) return;
    const y = e.clientY;
    const ids = pasosLocal.map((p) => p.id);
    let target = ids.indexOf(dragId);
    for (let i = 0; i < ids.length; i++) {
      const el = rowRefs.current[ids[i]];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { target = i; break; }
    }
    const cur = ids.indexOf(dragId);
    if (target !== cur && target >= 0) {
      const next = [...pasosLocal];
      const [m] = next.splice(cur, 1);
      next.splice(target, 0, m);
      setPasosLocal(next);
    }
  };
  const onHandleUp = () => {
    if (dragId) reordenarPasos(proyecto.id, pasosLocal);
    setDragId(null);
  };

  const hechos = pasosLocal.filter((s) => s.hecho).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-3 pt-3 pb-3 bg-white border-b border-[#E6E8EC]">
        <button onClick={onVolver} className="flex items-center gap-1 text-[14px] text-[#6B7280] mb-2"><ChevronLeft size={18} /> Proyectos</button>
        <div className="flex items-center gap-2.5 px-1">
          <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: proyecto.color }} />
          <h1 className="text-xl font-semibold tracking-tight flex-1">{proyecto.nombre}</h1>
          <span className="text-[12px] text-[#9AA1AC]">{hechos}/{pasosLocal.length}</span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {pasosLocal.length === 0 && <p className="text-[14px] text-[#9AA1AC] py-6 text-center">Sin pasos todavía. Agregá el primero abajo.</p>}
        {pasosLocal.map((s) => {
          const arrastrando = dragId === s.id;
          return (
            <div key={s.id} ref={(el) => (rowRefs.current[s.id] = el)}
              className="flex items-center gap-2 bg-white rounded-xl border px-2 py-2.5 transition"
              style={{ borderColor: arrastrando ? proyecto.color : "#E6E8EC", boxShadow: arrastrando ? "0 8px 20px rgba(0,0,0,0.12)" : "none", opacity: arrastrando ? 0.95 : 1 }}>
              <button onPointerDown={(e) => onHandleDown(e, s.id)} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
                className="text-[#C4C9D1] touch-none cursor-grab active:cursor-grabbing px-0.5" style={{ touchAction: "none" }}>
                <GripVertical size={18} />
              </button>
              <button onClick={() => actualizarPaso({ ...s, hecho: !s.hecho })} className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{ borderColor: proyecto.color, background: s.hecho ? proyecto.color : "transparent" }}>
                {s.hecho && <Check size={13} className="text-white" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={"text-[15px] truncate " + (s.hecho ? "line-through text-[#9AA1AC]" : "")}>{s.titulo}</p>
                {s.tareaId && <p className="text-[11px] mt-0.5" style={{ color: proyecto.color }}>Programado · ver en Semana</p>}
              </div>
              <button onClick={() => setAgendar(s)} className="shrink-0 p-1.5 rounded-lg" title="Agendar"
                style={{ color: s.tareaId ? proyecto.color : "#9AA1AC", background: s.tareaId ? proyecto.color + "14" : "transparent" }}>
                <CalendarPlus size={18} />
              </button>
              <button onClick={() => eliminarPaso(s)} className="shrink-0 p-1.5 text-[#C4C9D1] hover:text-[#DC2626]"><Trash2 size={15} /></button>
            </div>
          );
        })}

        <div className="flex items-center gap-2 bg-white rounded-xl border border-[#E6E8EC] px-3 py-2 mt-1">
          <Plus size={18} className="text-[#9AA1AC]" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()}
            placeholder="Agregar paso…" className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[#B6BCC6]" />
        </div>
      </div>

      {agendar && (
        <ModalAgendar paso={agendar} color={proyecto.color} hoy={hoy}
          onGuardar={(fecha, hora) => { agendarPaso(agendar, proyecto.id, fecha, hora); setAgendar(null); }}
          onQuitar={() => { desagendarPaso(agendar); setAgendar(null); }}
          onClose={() => setAgendar(null)} />
      )}
    </div>
  );
}

function ModalAgendar({ paso, color, hoy, onGuardar, onQuitar, onClose }) {
  const [fecha, setFecha] = useState(hoy);
  const [hora, setHora] = useState("09:00");
  const dias = Array.from({ length: 7 }, (_, i) => addDays(hoy, i));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Agendar paso</h2>
          <button onClick={onClose}><X size={22} className="text-[#9AA1AC]" /></button>
        </div>
        <p className="text-[14px] text-[#6B7280] mb-4">{paso.titulo}</p>

        <p className="text-[12px] text-[#6B7280] mb-1.5">Día</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {dias.map((d, i) => {
            const on = sameDay(d, fecha);
            return (
              <button key={i} onClick={() => setFecha(d)}
                className="shrink-0 px-3 py-2 rounded-xl text-center border transition"
                style={{ borderColor: on ? color : "#E6E8EC", background: on ? color + "14" : "transparent" }}>
                <span className="block text-[10px] uppercase text-[#9AA1AC]">{DIA_CORTO[d.getDay()]}</span>
                <span className="block text-[15px] font-semibold" style={{ color: on ? color : "#1B2430" }}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>

        <p className="text-[12px] text-[#6B7280] mt-4 mb-1.5">Hora</p>
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
          className="w-full bg-[#F4F5F7] rounded-lg px-3 py-2.5 outline-none text-[15px]" />

        <div className="flex gap-2 mt-5">
          <button onClick={() => onGuardar(fecha, hora)} className="flex-1 bg-[#1B2430] text-white rounded-lg py-2.5 text-[15px] font-medium">
            {paso.tareaId ? "Reprogramar" : "Agendar"}
          </button>
          {paso.tareaId && (
            <button onClick={onQuitar} className="px-4 border border-[#E6E8EC] text-[#6B7280] rounded-lg py-2.5 text-[15px]">Quitar</button>
          )}
        </div>
      </div>
    </div>
  );
}
