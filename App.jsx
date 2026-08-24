import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  LogOut,
  Plus,
  X,
  Trash2,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Lock,
  Paperclip,
  Repeat,
  Flag,
  Tag,
  MessageSquare,
  ListChecks,
  History,
  ArrowLeftRight,
  Info,
  UserCheck,
  Briefcase,
  Phone,
  DollarSign,
  Calendar,
  Package,
  Minus,
  Printer,
  ShoppingCart,
  ChevronDown,
  Stethoscope,
  Boxes,
  Upload,
  MessageCircle,
  CreditCard,
  Undo2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";

const CLINICAS = [
  { id: "sorridents", nome: "Sorridents Centro", curto: "Sorridents", baseRoleLabel: "Recepção", gerenteRoleLabel: "Gerente" },
  { id: "gio", nome: "GIO Estética Higienópolis", curto: "GIO Estética", baseRoleLabel: "Comercial", gerenteRoleLabel: "Supervisor Comercial" },
];

const STATUS = {
  pendente: { label: "Pendente", color: "var(--muted)" },
  em_andamento: { label: "Em andamento", color: "var(--warning)" },
  concluida: { label: "Concluída", color: "var(--success)" },
};
const STATUS_ORDER = ["pendente", "em_andamento", "concluida"];

const PRIORIDADES = {
  alta: { label: "Alta", color: "var(--danger)", bg: "var(--danger-soft)" },
  media: { label: "Média", color: "var(--warning)", bg: "var(--warning-soft)" },
  baixa: { label: "Baixa", color: "var(--muted)", bg: "#EAEDEA" },
};
const PRIORIDADE_ORDER = ["alta", "media", "baixa"];

const CATEGORIAS = [
  { id: "atendimento", label: "Atendimento" },
  { id: "financeiro", label: "Financeiro" },
  { id: "limpeza", label: "Limpeza" },
  { id: "estoque", label: "Estoque" },
  { id: "outro", label: "Outro" },
];
function categoriaLabel(id) {
  return CATEGORIAS.find((c) => c.id === id)?.label || id;
}

// ---------- Kanban comercial ----------
const LEAD_STAGES = [
  { id: "indicacao_recebida", label: "Indicação recebida" },
  { id: "avaliacao_agendada", label: "Avaliação agendada" },
  { id: "faltou_avaliacao", label: "Faltou na avaliação" },
  { id: "orcamento_apresentado", label: "Orçamento apresentado" },
  { id: "negociacao", label: "Em negociação" },
  { id: "follow_up", label: "Follow-up" },
  { id: "aguardando_pagamento", label: "Aguardando pagamento" },
  { id: "fechado", label: "Fechado" },
  { id: "perdido", label: "Perdido" },
];
const ORIGENS_LEAD = [
  { id: "instagram", label: "Instagram" },
  { id: "indicacao", label: "Indicação" },
  { id: "site", label: "Site" },
  { id: "google", label: "Google" },
  { id: "outro", label: "Outro" },
];
function origemLabel(id) {
  return ORIGENS_LEAD.find((o) => o.id === id)?.label || id;
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return null;
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Monta o link do WhatsApp Web já abrindo a conversa do número (assume Brasil quando faltar o DDI).
function waLink(whatsapp) {
  if (!whatsapp) return null;
  let digits = String(whatsapp).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 11) digits = "55" + digits;
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}`;
}

function mapLead(row) {
  return {
    id: row.id,
    clinicaId: row.clinica_id,
    etapa: row.etapa,
    nomePaciente: row.nome_paciente,
    codigoPaciente: row.codigo_paciente,
    whatsapp: row.whatsapp,
    responsavelComercial: row.responsavel_comercial,
    procedimento: row.procedimento,
    valorOrcado: row.valor_orcado,
    valorPago: row.valor_pago,
    origem: row.origem,
    indicadoPor: row.indicado_por,
    dataAvaliacao: row.data_avaliacao,
    proximoContato: row.proximo_contato,
    prioridade: row.prioridade,
    historia: row.historia,
    evolucao: row.evolucao,
    indicadoPorTecnicoId: row.indicado_por_tecnico_id,
    observacoes: row.observacoes,
    criadoPor: row.criado_por,
    criadoEm: row.criado_em,
  };
}

function mapCobranca(row) {
  return {
    id: row.id,
    clinicaId: row.clinica_id,
    nomeCliente: row.nome_cliente,
    whatsapp: row.whatsapp,
    formaPagamento: row.forma_pagamento,
    diaVencimento: row.dia_vencimento,
    valorParcela: row.valor_parcela,
    numeroParcelas: row.numero_parcelas,
    parcelasPagas: row.parcelas_pagas,
    observacoes: row.observacoes,
    ativo: row.ativo,
    criadoPor: row.criado_por,
    criadoEm: row.criado_em,
  };
}

// ---------- Controle de cobranças (boleto / recorrente) da GIO ----------
// Quantos dias de "folga" depois do dia certo a tarefa ainda pode ser criada,
// caso ninguém tenha aberto o app exatamente naquele dia (a checagem roda ao
// abrir o Pulso, não é um agendamento automático no servidor).
const COBRANCA_GRACE_DAYS = 6;

function clampDayToMonth(year, monthIndex0, day) {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  return Math.min(day, lastDay);
}

// Data do vencimento desse mês (ex: dia 31 num mês com 30 dias vira o
// último dia do mês, em vez de estourar pro mês seguinte).
function dueDateThisCycle(diaVencimento, refDateISO) {
  const [y, m] = refDateISO.split("-").map(Number);
  const day = clampDayToMonth(y, m - 1, diaVencimento);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysISO(dateISO, n) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Subtrai N dias úteis (só pula sábado/domingo — sem calendário de feriados).
function subtractBusinessDays(dateISO, n) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  let remaining = n;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

// Decide se uma cobrança precisa gerar tarefa hoje, e qual. Retorna null se
// não for o caso (fora da janela, já pagou todas as parcelas, ou inativa).
function daysBetweenISO(aISO, bISO) {
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

function computeCobrancaTask(cobranca, hojeISO) {
  if (!cobranca.ativo) return null;
  if (cobranca.parcelasPagas >= cobranca.numeroParcelas) return null;
  const vencimento = dueDateThisCycle(cobranca.diaVencimento, hojeISO);
  const janelaFim = addDaysISO(vencimento, COBRANCA_GRACE_DAYS);
  let janelaInicio, titulo;
  if (cobranca.formaPagamento === "boleto") {
    janelaInicio = subtractBusinessDays(vencimento, 1);
    titulo = `Enviar 2ª via do boleto — ${cobranca.nomeCliente}`;
  } else {
    janelaInicio = vencimento;
    titulo = `Conferir pagamento recorrente — ${cobranca.nomeCliente}`;
  }
  if (hojeISO < janelaInicio || hojeISO > janelaFim) return null;
  return { titulo, prazo: vencimento };
}

function mapIndicacao(row) {
  return {
    id: row.id,
    clinicaId: row.clinica_id,
    tecnicoId: row.tecnico_id,
    nomePaciente: row.nome_paciente,
    procedimento: row.procedimento,
    observacao: row.observacao,
    dataIndicacao: row.data_indicacao,
    leadId: row.lead_id,
    criadoEm: row.criado_em,
  };
}

// Data relevante de contato do lead: na etapa "avaliação agendada" é a data
// da avaliação; nas outras, é o próximo contato marcado (follow-up). É a
// mesma regra que já decide qual data o card mostra (ver LeadCard).
function leadContatoRelevante(lead) {
  if (lead.etapa === "avaliacao_agendada" && lead.dataAvaliacao) return lead.dataAvaliacao;
  return lead.proximoContato;
}

function isFollowUpAtrasado(lead) {
  const data = leadContatoRelevante(lead);
  if (!data) return false;
  if (lead.etapa === "fechado" || lead.etapa === "perdido") return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(data + "T00:00:00");
  return d < hoje;
}

function isFollowUpHoje(lead) {
  const data = leadContatoRelevante(lead);
  if (!data) return false;
  if (lead.etapa === "fechado" || lead.etapa === "perdido") return false;
  return data === todayISO();
}

function clinicaInfo(id) {
  return CLINICAS.find((c) => c.id === id) || { nome: "—", curto: "—", baseRoleLabel: "Equipe", gerenteRoleLabel: "Gerente" };
}

// ---------- Estoque ----------
function mapEstoqueItem(row) {
  return {
    id: row.id,
    clinicaId: row.clinica_id,
    tipo: row.tipo || "clinico",
    categoria: row.categoria || "Outros",
    nome: row.nome,
    quantidadeIdeal: Number(row.quantidade_ideal) || 0,
    quantidadeAtual: Number(row.quantidade_atual) || 0,
    criadoEm: row.criado_em,
  };
}

function quantoComprar(item) {
  return Math.max(item.quantidadeIdeal - item.quantidadeAtual, 0);
}

function fmtQty(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function mesAnoLabel() {
  const d = new Date();
  const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${meses[d.getMonth()]}/${d.getFullYear()}`;
}

function roleLabel(role, clinicaId) {
  if (role === "owner") return "Gestor";
  if (role === "gerente") return clinicaInfo(clinicaId).gerenteRoleLabel;
  if (role === "tecnico") return "Técnico";
  return clinicaInfo(clinicaId).baseRoleLabel;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Força a tela inteira a re-renderizar assim que vira o dia, pra "atrasada"
// (que compara com a data de hoje) ficar certo sem precisar de ninguém
// recarregar a página na virada da meia-noite.
function useMidnightTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let id;
    function scheduleNext() {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      id = setTimeout(() => {
        setTick((t) => t + 1);
        scheduleNext();
      }, next.getTime() - now.getTime());
    }
    scheduleNext();
    return () => clearTimeout(id);
  }, []);
}

function isAtrasada(task) {
  if (task.status === "concluida") return false;
  if (!task.prazo) return false;
  return task.prazo < todayISO();
}

function isVenceHoje(task) {
  if (task.status === "concluida") return false;
  if (!task.prazo) return false;
  return task.prazo === todayISO();
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function lastNDays(n) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function memberName(id, team) {
  return team.find((m) => m.id === id)?.nome || "—";
}

// ---------- Importação do relatório de agendas (Excel) pro Comercial da Sorridents ----------
function normHeaderCell(s) {
  return String(s || "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

function toTitleCaseName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function parseDateBR(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return s.slice(0, 10);
  return null;
}

// Lê o relatório de agendas exportado do sistema (formato: título + linhas em branco no topo,
// depois uma linha de cabeçalho com "Cod. Pac.", "Nome Paciente", "Data Consulta", "Telefone Cel").
function parseAgendaRows(rows) {
  let headerIdx = -1;
  let colCodigo = -1;
  let colNome = -1;
  let colData = -1;
  let colTelefone = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const idx = row.findIndex((c) => normHeaderCell(c) === "cod pac");
    if (idx !== -1) {
      headerIdx = i;
      colCodigo = idx;
      colNome = row.findIndex((c) => normHeaderCell(c) === "nome paciente");
      colData = row.findIndex((c) => normHeaderCell(c) === "data consulta");
      colTelefone = row.findIndex((c) => normHeaderCell(c) === "telefone cel");
      break;
    }
  }
  if (headerIdx === -1 || colCodigo === -1 || colNome === -1) return { rows: [], missing: [] };
  // Se o cabeçalho mudar um pouco no futuro (ex: "Telefone Cel" virar outro
  // texto), a importação não trava, mas também não deve dizer "sucesso" sem
  // avisar que um campo ficou de fora — guarda quais colunas não bateram.
  const missing = [];
  if (colData === -1) missing.push("Data Consulta");
  if (colTelefone === -1) missing.push("Telefone Cel");
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const codigo = String(row[colCodigo] || "").trim();
    const nome = String(row[colNome] || "").trim();
    if (!codigo || !nome) continue;
    out.push({
      codigoPaciente: codigo,
      nomePaciente: toTitleCaseName(nome),
      dataAvaliacao: colData !== -1 ? parseDateBR(row[colData]) : null,
      whatsapp: colTelefone !== -1 ? String(row[colTelefone] || "").trim() || null : null,
    });
  }
  return { rows: out, missing };
}

const WEEKDAYS = [
  { v: 0, label: "Dom" },
  { v: 1, label: "Seg" },
  { v: 2, label: "Ter" },
  { v: 3, label: "Qua" },
  { v: 4, label: "Qui" },
  { v: 5, label: "Sex" },
  { v: 6, label: "Sáb" },
];

// Calcula o próximo prazo a partir do prazo atual e de uma regra de
// recorrência, mantendo a agenda fixa (não depende de quando a tarefa foi
// concluída, só do prazo dela).
function computeNextPrazo(currentPrazoISO, recurrence) {
  if (!currentPrazoISO || !recurrence) return null;
  const [y, m, d] = currentPrazoISO.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));

  if (recurrence.type === "dias") {
    const interval = Math.max(1, recurrence.interval || 1);
    const next = new Date(cur);
    next.setUTCDate(next.getUTCDate() + interval);
    return next.toISOString().slice(0, 10);
  }

  if (recurrence.type === "semanas") {
    const interval = Math.max(1, recurrence.interval || 1);
    const weekdays = (recurrence.weekdays && recurrence.weekdays.length ? recurrence.weekdays : [cur.getUTCDay()])
      .slice()
      .sort((a, b) => a - b);
    const curDow = cur.getUTCDay();
    let minDiff = Infinity;
    weekdays.forEach((w) => {
      let diff = (w - curDow + 7) % 7;
      if (diff === 0) diff = 7;
      if (diff < minDiff) minDiff = diff;
    });
    const wrapped = curDow + minDiff >= 7;
    const extraWeeks = wrapped ? interval - 1 : 0;
    const next = new Date(cur);
    next.setUTCDate(next.getUTCDate() + minDiff + extraWeeks * 7);
    return next.toISOString().slice(0, 10);
  }

  if (recurrence.type === "mensal") {
    const interval = Math.max(1, recurrence.interval || 1);
    const dayOfMonth = recurrence.dayOfMonth || d;
    let targetMonth = m - 1 + interval;
    const targetYear = y + Math.floor(targetMonth / 12);
    targetMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const day = Math.min(dayOfMonth, lastDay);
    return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
  }

  return null;
}

function recurrenceLabel(r) {
  if (!r) return null;
  if (r.type === "dias") {
    return r.interval === 1 ? "Repete todo dia" : `Repete a cada ${r.interval} dias`;
  }
  if (r.type === "semanas") {
    const names = (r.weekdays || []).map((w) => WEEKDAYS.find((x) => x.v === w)?.label).filter(Boolean).join(", ");
    const every = r.interval === 1 ? "toda semana" : `a cada ${r.interval} semanas`;
    return `Repete ${every}${names ? " (" + names + ")" : ""}`;
  }
  if (r.type === "mensal") {
    const every = r.interval === 1 ? "todo mês" : `a cada ${r.interval} meses`;
    return `Repete ${every}, dia ${r.dayOfMonth}`;
  }
  return "Repete";
}

function getAssignableOptions(user, team) {
  // Técnico nunca aparece como opção de responsável: o papel só tem acesso à
  // aba Indicações, não tem "Minhas tarefas" pra ver/concluir nada atribuído.
  const semTecnico = team.filter((m) => m.role !== "tecnico");
  if (user.role === "owner") return semTecnico;
  if (user.role === "gerente") {
    return semTecnico.filter((m) => m.clinicaId === user.clinicaId || m.role === "owner");
  }
  return semTecnico.filter(
    (m) => m.id === user.id || (m.role === "gerente" && m.clinicaId === user.clinicaId)
  );
}

function mapProfile(row) {
  return {
    id: row.id,
    nome: row.nome,
    role: row.role,
    clinicaId: row.clinica_id,
    loginEmail: row.login_email,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao || "",
    clinicaId: row.clinica_id,
    responsavelId: row.responsavel_id,
    status: row.status,
    prazo: row.prazo,
    criadoEm: row.criado_em,
    concluidoEm: row.concluido_em,
    recorrencia: row.recorrencia || null,
    prioridade: row.prioridade || "media",
    categoria: row.categoria || null,
    cobrancaId: row.cobranca_id || null,
    leadId: row.lead_id || null,
  };
}

function mapAttachment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    path: row.file_path,
    fileName: row.file_name,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function mapComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    autorId: row.autor_id,
    texto: row.texto,
    createdAt: row.created_at,
  };
}

function mapChecklistItem(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    texto: row.texto,
    concluido: row.concluido,
    ordem: row.ordem,
  };
}

function mapActivity(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    autorId: row.autor_id,
    tipo: row.tipo,
    detalhe: row.detalhe,
    createdAt: row.created_at,
  };
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function activityLabel(a) {
  if (a.tipo === "criada") return "Tarefa criada";
  if (a.tipo === "status_alterado") return `Status: ${a.detalhe}`;
  if (a.tipo === "delegada") return `Delegada: ${a.detalhe}`;
  if (a.tipo === "prioridade_alterada") return `Prioridade: ${a.detalhe}`;
  if (a.tipo === "categoria_alterada") return `Categoria: ${a.detalhe}`;
  if (a.tipo === "recorrencia_parada") return "Recorrência interrompida";
  return a.detalhe || a.tipo;
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

    .gec-root {
      --bg: #F2F5F3;
      --surface: #FFFFFF;
      --ink: #16231F;
      --muted: #5C6E68;
      --primary: #0E5C4F;
      --primary-dark: #0A4A40;
      --primary-soft: #DCEEE7;
      --accent: #B8712E;
      --accent-soft: #F3E2CE;
      --success: #2F9E6E;
      --success-soft: #DEF1E7;
      --warning: #D98F2B;
      --warning-soft: #FBEBD5;
      --danger: #C24949;
      --danger-soft: #F7E3E3;
      --line: #E1E5E1;
      font-family: 'IBM Plex Sans', sans-serif;
      color: var(--ink);
      background: var(--bg);
      min-height: 100%;
      width: 100%;
    }
    .gec-root * { box-sizing: border-box; }
    .gec-display { font-family: 'Fraunces', serif; }
    .gec-mono { font-family: 'IBM Plex Mono', monospace; }

    @media (prefers-reduced-motion: reduce) {
      .gec-root * { animation: none !important; transition: none !important; }
    }

    .gec-fade-in { animation: gecFadeIn .5s ease both; }
    @keyframes gecFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .gec-btn {
      font-family: 'IBM Plex Sans', sans-serif;
      font-weight: 600;
      font-size: 13.5px;
      border-radius: 8px;
      padding: 9px 16px;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background .15s ease, border-color .15s ease, transform .1s ease;
    }
    .gec-btn:active { transform: scale(0.98); }
    .gec-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .gec-btn-primary { background: var(--primary); color: #fff; }
    .gec-btn-primary:hover { background: var(--primary-dark); }
    .gec-btn-primary:disabled { opacity: .6; cursor: default; }
    .gec-btn-ghost { background: transparent; color: var(--ink); border-color: var(--line); }
    .gec-btn-ghost:hover { background: #EAEDEA; }
    .gec-btn-danger { background: transparent; color: var(--danger); border-color: var(--danger-soft); }
    .gec-btn-danger:hover { background: var(--danger-soft); }

    .gec-input, .gec-select, .gec-textarea {
      font-family: 'IBM Plex Sans', sans-serif;
      font-size: 14px;
      padding: 9px 11px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      width: 100%;
    }
    .gec-input:focus-visible, .gec-select:focus-visible, .gec-textarea:focus-visible {
      outline: 2px solid var(--primary); outline-offset: 1px; border-color: var(--primary);
    }
    .gec-label {
      font-size: 12px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: .04em;
      margin-bottom: 6px; display: block;
    }

    .gec-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
    }

    .gec-pill {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
    }

    .gec-nav-tab {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600;
      color: var(--muted); cursor: pointer; white-space: nowrap; border: 1px solid transparent;
      transition: background .15s ease, color .15s ease;
    }
    .gec-nav-tab:hover { background: var(--primary-soft); color: var(--primary-dark); }
    .gec-nav-tab.active { background: var(--primary); color: #fff; }
    .gec-nav-tab:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    .gec-clinic-tab {
      display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer;
      border: 1px solid var(--line); background: var(--surface); white-space: nowrap;
      transition: background .15s ease, color .15s ease, border-color .15s ease;
    }
    .gec-clinic-tab.active { background: var(--ink); color: #fff; border-color: var(--ink); }

    .gec-pulse-cell {
      width: 14px; height: 14px; border-radius: 4px;
      background: #EAEDEA; border: 1px solid var(--line);
      flex-shrink: 0;
    }

    .gec-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
    .gec-scrollbar::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }

    .gec-login-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: 0 20px 60px -25px rgba(14,92,79,0.35);
    }

    .gec-person-btn {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; padding: 13px 16px; border-radius: 11px;
      border: 1px solid var(--line); background: var(--surface);
      cursor: pointer; transition: border-color .15s ease, background .15s ease;
      text-align: left;
    }
    .gec-person-btn:hover { border-color: var(--primary); background: var(--primary-soft); }
    .gec-person-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    .gec-modal-overlay {
      position: fixed; inset: 0; background: rgba(22,35,31,0.45);
      display: flex; align-items: flex-end; justify-content: center;
      z-index: 50; padding: 0;
      animation: gecFadeIn .2s ease both;
    }
    @media (min-width: 640px) {
      .gec-modal-overlay { align-items: center; padding: 20px; }
    }
    .gec-modal {
      background: var(--surface); width: 100%; max-width: 480px;
      border-radius: 18px 18px 0 0; padding: 22px;
      max-height: 88vh; overflow-y: auto;
    }
    @media (min-width: 640px) {
      .gec-modal { border-radius: 18px; }
    }

    .gec-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .gec-column {
      background: #F8FAF9;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
    }
    .gec-task-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    @media print {
      body * { visibility: hidden; }
      .gec-print-area, .gec-print-area * { visibility: visible; }
      .gec-print-area {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        padding: 24px;
      }
      .gec-print-hide { display: none !important; }
    }
  `}</style>
);

function Avatar({ nome, size = 32 }) {
  const initials = (nome || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--primary-soft)",
        color: "var(--primary-dark)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        fontFamily: "'IBM Plex Sans', sans-serif",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function StatusPill({ status, atrasada }) {
  if (atrasada) {
    return (
      <span className="gec-pill" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
        <AlertTriangle size={12} /> Atrasada
      </span>
    );
  }
  // Fallback pra não quebrar se algum dia aparecer um status fora dos 3
  // esperados (hoje não tem uso ativo, mas é barato travar antes que vire
  // problema de verdade).
  const s = STATUS[status] || { label: status || "—", color: "var(--muted)" };
  const bgMap = {
    pendente: "#EAEDEA",
    em_andamento: "var(--warning-soft)",
    concluida: "var(--success-soft)",
  };
  return (
    <span className="gec-pill" style={{ background: bgMap[status], color: s.color }}>
      {status === "concluida" ? <CheckCircle2 size={12} /> : status === "em_andamento" ? <Clock size={12} /> : <Circle size={12} />}
      {s.label}
    </span>
  );
}

function PriorityPill({ prioridade }) {
  const p = PRIORIDADES[prioridade] || PRIORIDADES.media;
  if (prioridade === "media") return null;
  return (
    <span className="gec-pill" style={{ background: p.bg, color: p.color }}>
      <Flag size={11} /> {p.label}
    </span>
  );
}

function CategoryTag({ categoria }) {
  if (!categoria) return null;
  return (
    <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>
      <Tag size={11} /> {categoriaLabel(categoria)}
    </span>
  );
}

// ---------- Aviso de tarefas em atraso e vencendo hoje ----------
function OverdueBanner({ tasks, team, onOpenTask, includeToday = false, showResponsavel = true, extraItems = [] }) {
  const taskItems = useMemo(
    () =>
      tasks
        .filter((t) => isAtrasada(t) || (includeToday && isVenceHoje(t)))
        .map((t) => ({
          id: `t-${t.id}`,
          titulo: t.titulo,
          prazo: t.prazo,
          tipo: isAtrasada(t) ? "atrasada" : "hoje",
          subtitulo: showResponsavel ? memberName(t.responsavelId, team) : null,
          onOpen: () => onOpenTask && onOpenTask(t),
        })),
    [tasks, includeToday, team, showResponsavel, onOpenTask]
  );
  const relevantes = useMemo(
    () => [...taskItems, ...extraItems].sort((a, b) => (a.prazo || "").localeCompare(b.prazo || "")),
    [taskItems, extraItems]
  );
  if (relevantes.length === 0) return null;
  const visible = relevantes.slice(0, 5);
  const resto = relevantes.length - visible.length;
  const atrasadasCount = relevantes.filter((i) => i.tipo === "atrasada").length;
  const hojeCount = relevantes.filter((i) => i.tipo === "hoje").length;
  const followupCount = relevantes.filter((i) => i.tipo === "followup").length;
  const corPrincipal = atrasadasCount > 0 ? "var(--danger)" : "var(--warning)";
  const bgPrincipal = atrasadasCount > 0 ? "var(--danger-soft)" : "var(--warning-soft)";
  const titulo = includeToday
    ? [
        atrasadasCount > 0 ? `${atrasadasCount} ${atrasadasCount === 1 ? "atrasada" : "atrasadas"}` : null,
        hojeCount > 0 ? `${hojeCount} vencendo hoje` : null,
        followupCount > 0 ? `${followupCount} follow-up${followupCount === 1 ? "" : "s"} hoje` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : `${relevantes.length} ${relevantes.length === 1 ? "tarefa atrasada" : "tarefas atrasadas"}`;
  const pillStyle = { fontSize: 10, padding: "2px 7px", color: "#fff" };
  return (
    <div
      className="gec-card gec-fade-in"
      style={{ padding: 18, marginBottom: 22, border: `1px solid ${corPrincipal}`, background: bgPrincipal }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <AlertTriangle size={16} color={corPrincipal} />
        <div className="gec-display" style={{ fontSize: 15, fontWeight: 600, color: corPrincipal }}>
          {titulo}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((item) => (
          <button
            key={item.id}
            onClick={item.onOpen}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 9,
              padding: "8px 12px",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>{item.titulo}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
              {item.tipo === "atrasada" && <span className="gec-pill" style={{ ...pillStyle, background: "var(--danger)" }}>Atrasada</span>}
              {item.tipo === "hoje" && <span className="gec-pill" style={{ ...pillStyle, background: "var(--warning)" }}>Hoje</span>}
              {item.tipo === "followup" && <span className="gec-pill" style={{ ...pillStyle, background: "var(--primary)" }}>Follow-up</span>}
              {item.subtitulo && `${item.subtitulo} · `}prazo {fmtDate(item.prazo)}
            </span>
          </button>
        ))}
        {resto > 0 && <div style={{ fontSize: 12, color: corPrincipal, textAlign: "center" }}>+{resto} mais</div>}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="gec-fade-in" style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
      <Icon size={30} style={{ marginBottom: 10, opacity: 0.5 }} />
      <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 15 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13.5, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ---------- Login (nome -> senha, autenticado de verdade via Supabase Auth) ----------
function LoginScreen() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!login.trim() || !password) return;
    setSubmitting(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: login.trim(),
      password,
    });
    setSubmitting(false);
    if (error) setError("Login ou senha incorretos. Tente de novo.");
  }

  return (
    <div className="gec-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <GlobalStyle />
      <div className="gec-login-card gec-fade-in" style={{ width: "100%", maxWidth: 380, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ClipboardList size={19} color="#fff" />
          </div>
          <div>
            <div className="gec-display" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>Pulso</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>gestão das clínicas</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="gec-label" htmlFor="login">Login</label>
            <input
              id="login"
              type="text"
              className="gec-input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoFocus
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="gec-label" htmlFor="senha">Senha</label>
            <input
              id="senha"
              type="password"
              className="gec-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
          <button type="submit" className="gec-btn gec-btn-primary" style={{ justifyContent: "center" }} disabled={submitting}>
            <Lock size={14} /> {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- Perfil sem clínica vinculada: bloqueia o app com um aviso claro,
// em vez de deixar a pessoa navegar por telas vazias sem entender o motivo.
function NoClinicaScreen({ onLogout }) {
  return (
    <div className="gec-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <GlobalStyle />
      <div className="gec-login-card gec-fade-in" style={{ width: "100%", maxWidth: 380, padding: 32, textAlign: "center" }}>
        <AlertTriangle size={26} color="var(--danger)" style={{ marginBottom: 12 }} />
        <div className="gec-display" style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Sua conta ainda não está vinculada a uma clínica</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 20 }}>
          Fale com o administrador do sistema pra liberar seu acesso.
        </div>
        <button className="gec-btn gec-btn-ghost" style={{ justifyContent: "center", width: "100%" }} onClick={onLogout}>
          Sair
        </button>
      </div>
    </div>
  );
}

// ---------- Pulse strip ----------
function PulseStrip({ tasks, memberId, days = 14 }) {
  const dayList = lastNDays(days);
  const counts = useMemo(() => {
    const map = {};
    dayList.forEach((d) => (map[d] = 0));
    tasks
      .filter((t) => t.responsavelId === memberId && t.status === "concluida" && t.concluidoEm)
      .forEach((t) => {
        const d = t.concluidoEm.slice(0, 10);
        if (d in map) map[d] += 1;
      });
    return map;
  }, [tasks, memberId, dayList]);

  function cellStyle(n) {
    if (n === 0) return { background: "#EAEDEA", border: "1px solid var(--line)" };
    if (n === 1) return { background: "var(--primary-soft)", border: "1px solid var(--primary-soft)" };
    if (n === 2) return { background: "#8FC4B6", border: "1px solid #8FC4B6" };
    return { background: "var(--primary)", border: "1px solid var(--primary)" };
  }

  return (
    <div className="gec-scrollbar" style={{ display: "flex", gap: 4, overflowX: "auto", padding: "2px 0" }}>
      {dayList.map((d) => (
        <div key={d} className="gec-pulse-cell" style={cellStyle(counts[d])} title={`${d}: ${counts[d]} concluída(s)`} />
      ))}
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ team, tasks, onOpenTask }) {
  const stats = useMemo(() => {
    const total = tasks.length;
    const concluidas = tasks.filter((t) => t.status === "concluida").length;
    const atrasadas = tasks.filter((t) => isAtrasada(t)).length;
    const emAndamento = tasks.filter((t) => t.status === "em_andamento").length;
    return { total, concluidas, atrasadas, emAndamento };
  }, [tasks]);

  const chartData = useMemo(
    () =>
      team.map((m) => {
        const mine = tasks.filter((t) => t.responsavelId === m.id);
        return {
          nome: m.nome.split(" ")[0],
          Concluídas: mine.filter((t) => t.status === "concluida").length,
          Pendentes: mine.filter((t) => t.status !== "concluida").length,
        };
      }),
    [team, tasks]
  );

  return (
    <div className="gec-fade-in">
      <OverdueBanner tasks={tasks} team={team} onOpenTask={onOpenTask} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
        <div className="gec-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>TOTAL DE TAREFAS</div>
          <div className="gec-display" style={{ fontSize: 28, fontWeight: 600 }}>{stats.total}</div>
        </div>
        <div className="gec-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--success)", fontWeight: 600, marginBottom: 6 }}>CONCLUÍDAS</div>
          <div className="gec-display" style={{ fontSize: 28, fontWeight: 600, color: "var(--success)" }}>{stats.concluidas}</div>
        </div>
        <div className="gec-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--warning)", fontWeight: 600, marginBottom: 6 }}>EM ANDAMENTO</div>
          <div className="gec-display" style={{ fontSize: 28, fontWeight: 600, color: "var(--warning)" }}>{stats.emAndamento}</div>
        </div>
        <div className="gec-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>ATRASADAS</div>
          <div className="gec-display" style={{ fontSize: 28, fontWeight: 600, color: "var(--danger)" }}>{stats.atrasadas}</div>
        </div>
      </div>

      {team.length > 0 && (
        <div className="gec-card" style={{ padding: 20, marginBottom: 22 }}>
          <div className="gec-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Produtividade por pessoa</div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12.5 }} />
                <Bar dataKey="Concluídas" stackId="a" fill="var(--primary)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Pendentes" stackId="a" fill="#D8DFDC" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="gec-card" style={{ padding: 20 }}>
        <div className="gec-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pulso de atividade</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Tarefas concluídas nos últimos 14 dias, por pessoa</div>
        {team.length === 0 && <EmptyState icon={Users} title="Cadastre sua equipe" subtitle="Peça pro gestor adicionar as funcionárias." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {team.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: 150, flexShrink: 0 }}>
                <Avatar nome={m.nome} size={26} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.nome}</div>
              </div>
              <PulseStrip tasks={tasks} memberId={m.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Anexos (seção usada dentro do TaskDetailModal) ----------
function AttachmentsSection({ task, attachments, canUpload, onUpload, onDelete }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setLocalError("");
    try {
      await onUpload(task, file);
      setFile(null);
    } catch (err) {
      setLocalError("Não foi possível enviar o arquivo.");
    }
    setUploading(false);
  }

  return (
    <div>
      {attachments.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Nenhum arquivo anexado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {attachments.map((a) => (
            <div key={a.id} className="gec-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <Paperclip size={14} color="var(--muted)" />
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flex: 1, fontSize: 13, color: "var(--ink)", fontWeight: 500, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {a.fileName}
                </a>
              ) : (
                <span style={{ flex: 1, fontSize: 13, color: "var(--muted)" }}>{a.fileName}</span>
              )}
              {canUpload && (
                <button className="gec-btn gec-btn-danger" style={{ padding: 6 }} onClick={() => onDelete(a)} aria-label="Remover anexo">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canUpload && (
        <form onSubmit={handleUpload} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} style={{ flex: 1, fontSize: 12.5 }} />
          <button type="submit" className="gec-btn gec-btn-primary" disabled={!file || uploading}>
            {uploading ? "Enviando…" : "Anexar"}
          </button>
        </form>
      )}
      {localError && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 8 }}>{localError}</div>}
    </div>
  );
}

// ---------- Concluir com anexo opcional ----------
function ConcludeModal({ task, onClose, onConfirm }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(task, file);
      onClose();
    } catch (err) {
      // Se der erro (ex: falha no envio do anexo), mantém o modal aberto e
      // libera o botão de novo — sem isso a pessoa ficava vendo "Concluindo…"
      // pra sempre, sem saber se deu certo ou não.
      setSubmitting(false);
      setError("Não foi possível concluir a tarefa. Verifique sua conexão e tente de novo.");
    }
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="gec-display" style={{ fontSize: 17, fontWeight: 600 }}>Concluir tarefa</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 13.5, marginBottom: 16 }}>{task.titulo}</div>
        <form onSubmit={handleConfirm} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="gec-label">Anexar arquivo (opcional)</label>
            <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} style={{ fontSize: 12.5, width: "100%" }} />
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
          <button type="submit" className="gec-btn gec-btn-primary" style={{ justifyContent: "center" }} disabled={submitting}>
            <CheckCircle2 size={15} /> {submitting ? "Concluindo…" : "Concluir tarefa"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- Recorrência ----------
function RecurrenceFields({ prazo, value, onChange }) {
  const enabled = !!value;
  function toggle() {
    if (enabled) onChange(null);
    else onChange({ type: "dias", interval: 1, weekdays: [], dayOfMonth: prazo ? Number(prazo.slice(8, 10)) : 1 });
  }
  function update(patch) {
    onChange({ ...value, ...patch });
  }
  function toggleWeekday(w) {
    const cur = value.weekdays || [];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a, b) => a - b);
    update({ weekdays: next });
  }
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        <span className="gec-label" style={{ margin: 0 }}>Repetir esta tarefa</span>
      </label>
      {enabled && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: "#F8FAF9", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <select className="gec-select" value={value.type} onChange={(e) => update({ type: e.target.value })}>
            <option value="dias">A cada N dia(s)</option>
            <option value="semanas">A cada N semana(s), em dias específicos</option>
            <option value="mensal">Mensal, num dia fixo</option>
          </select>

          {value.type === "dias" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              A cada
              <input type="number" min={1} className="gec-input" style={{ width: 70 }} value={value.interval} onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })} />
              dia(s)
            </div>
          )}

          {value.type === "semanas" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                A cada
                <input type="number" min={1} className="gec-input" style={{ width: 70 }} value={value.interval} onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })} />
                semana(s), nos dias:
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WEEKDAYS.map((w) => (
                  <button
                    type="button"
                    key={w.v}
                    onClick={() => toggleWeekday(w.v)}
                    className={`gec-nav-tab ${(value.weekdays || []).includes(w.v) ? "active" : ""}`}
                    style={{ padding: "6px 10px", fontSize: 12.5 }}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {value.type === "mensal" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
              A cada
              <input type="number" min={1} className="gec-input" style={{ width: 70 }} value={value.interval} onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })} />
              mês(es), no dia
              <input type="number" min={1} max={31} className="gec-input" style={{ width: 70 }} value={value.dayOfMonth} onChange={(e) => update({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- New Task Modal ----------
function NewTaskModal({ assignableOptions, lockedClinicaId, defaultResponsavelId, onClose, onCreate }) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [clinicaId, setClinicaId] = useState(lockedClinicaId || CLINICAS[0].id);
  const [responsavelId, setResponsavelId] = useState(defaultResponsavelId || assignableOptions[0]?.id || "");
  const [prazo, setPrazo] = useState(todayISO());
  const [file, setFile] = useState(null);
  const [recorrencia, setRecorrencia] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!titulo.trim() || !responsavelId) return;
    setSubmitting(true);
    setError("");
    try {
      await onCreate(
        {
          titulo: titulo.trim(),
          descricao: descricao.trim(),
          clinicaId: lockedClinicaId || clinicaId,
          responsavelId,
          prazo,
          recorrencia,
        },
        file
      );
      onClose();
    } catch (err) {
      // Se der erro (ex: falha no envio do anexo), mantém o modal aberto com
      // o que já foi digitado e libera o botão de novo — sem isso a pessoa
      // ficava vendo "Criando…" pra sempre, sem saber se deu certo ou não.
      setSubmitting(false);
      setError("Não foi possível criar a tarefa. Verifique sua conexão e tente de novo.");
    }
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>Nova tarefa</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="gec-label" htmlFor="titulo">Título</label>
            <input id="titulo" className="gec-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Conferir estoque de anestésico" required />
          </div>
          <div>
            <label className="gec-label" htmlFor="descricao">Descrição (opcional)</label>
            <textarea id="descricao" className="gec-textarea" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: lockedClinicaId ? "1fr" : "1fr 1fr", gap: 12 }}>
            {!lockedClinicaId && (
              <div>
                <label className="gec-label" htmlFor="clinica">Clínica</label>
                <select id="clinica" className="gec-select" value={clinicaId} onChange={(e) => setClinicaId(e.target.value)}>
                  {CLINICAS.map((c) => (
                    <option key={c.id} value={c.id}>{c.curto}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="gec-label" htmlFor="prazo">Prazo</label>
              <input id="prazo" type="date" className="gec-input" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="gec-label" htmlFor="responsavel">Responsável</label>
            {assignableOptions.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Nenhuma pessoa disponível pra atribuir.</div>
            ) : (
              <select id="responsavel" className="gec-select" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
                {assignableOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="gec-label">Anexar arquivo (opcional)</label>
            <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} style={{ fontSize: 12.5, width: "100%" }} />
          </div>
          <RecurrenceFields prazo={prazo} value={recorrencia} onChange={setRecorrencia} />
          {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
          <button type="submit" className="gec-btn gec-btn-primary" style={{ justifyContent: "center", marginTop: 6 }} disabled={assignableOptions.length === 0 || submitting}>
            <Plus size={15} /> {submitting ? "Criando…" : "Criar tarefa"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- Detalhes da tarefa: prioridade, categoria, delegar, checklist, comentários, anexos, histórico ----------
function TaskDetailModal({
  task,
  team,
  currentUser,
  canManage,
  assignableOptions,
  attachments,
  comments,
  checklist,
  activity,
  onClose,
  onUploadAttachment,
  onDeleteAttachment,
  onAddComment,
  onDeleteComment,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onUpdatePriority,
  onUpdateCategoria,
  onDelegate,
  onStopRecurrence,
  onGoToCobrancas,
  onGoToLead,
  onUpdateStatus,
}) {
  const [novoComentario, setNovoComentario] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [delegando, setDelegando] = useState(false);
  const [delegadoPara, setDelegadoPara] = useState("");

  const checklistDone = checklist.filter((c) => c.concluido).length;

  function submitComment(e) {
    e.preventDefault();
    if (!novoComentario.trim()) return;
    onAddComment(task.id, novoComentario.trim());
    setNovoComentario("");
  }
  function submitChecklistItem(e) {
    e.preventDefault();
    if (!novoItem.trim()) return;
    onAddChecklistItem(task.id, novoItem.trim());
    setNovoItem("");
  }
  function confirmDelegate() {
    if (!delegadoPara) return;
    onDelegate(task.id, delegadoPara);
    setDelegando(false);
    setDelegadoPara("");
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 10 }}>
          <div className="gec-display" style={{ fontSize: 17, fontWeight: 600 }}>{task.titulo}</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7, flexShrink: 0 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        {task.descricao && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{task.descricao}</div>}
        {task.cobrancaId && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {task.status !== "concluida" && onUpdateStatus && (
              <button
                className="gec-btn gec-btn-primary"
                style={{ fontSize: 12, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => onUpdateStatus(task.id, "concluida")}
              >
                <CheckCircle2 size={13} /> Marcar parcela como paga
              </button>
            )}
            {task.status === "concluida" && onUpdateStatus && (
              <>
                <span className="gec-pill" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
                  <CheckCircle2 size={11} /> Parcela marcada como paga
                </span>
                <button
                  className="gec-btn gec-btn-ghost"
                  style={{ fontSize: 12, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => onUpdateStatus(task.id, "pendente")}
                >
                  <Undo2 size={13} /> Desfazer
                </button>
              </>
            )}
            {onGoToCobrancas && (
              <button
                className="gec-btn gec-btn-ghost"
                style={{ fontSize: 12, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => {
                  onClose();
                  onGoToCobrancas();
                }}
              >
                <CreditCard size={13} /> Ver cobrança
              </button>
            )}
          </div>
        )}
        {task.leadId && onGoToLead && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <button
              className="gec-btn gec-btn-ghost"
              style={{ fontSize: 12, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => {
                onClose();
                onGoToLead();
              }}
            >
              <Briefcase size={13} /> Ver lead
            </button>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <span>{clinicaInfo(task.clinicaId).curto}</span>
          <span>·</span>
          <span className="gec-mono">prazo {fmtDate(task.prazo)}</span>
          {isAtrasada(task) && (
            <>
              <span>·</span>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>crítica</span>
            </>
          )}
          {task.recorrencia && (
            <>
              <span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary-dark)" }}>
                <Repeat size={11} /> {recurrenceLabel(task.recorrencia)}
              </span>
            </>
          )}
        </div>

        {/* Prioridade e categoria */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label className="gec-label">Prioridade</label>
            {canManage ? (
              <select className="gec-select" value={task.prioridade} onChange={(e) => onUpdatePriority(task.id, e.target.value)}>
                {PRIORIDADE_ORDER.map((p) => (
                  <option key={p} value={p}>{PRIORIDADES[p].label}</option>
                ))}
              </select>
            ) : (
              <PriorityPill prioridade={task.prioridade} />
            )}
          </div>
          <div>
            <label className="gec-label">Categoria</label>
            {canManage ? (
              <select className="gec-select" value={task.categoria || ""} onChange={(e) => onUpdateCategoria(task.id, e.target.value || null)}>
                <option value="">Sem categoria</option>
                {CATEGORIAS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            ) : (
              <CategoryTag categoria={task.categoria} />
            )}
          </div>
        </div>

        {/* Responsável / delegar */}
        <div style={{ marginBottom: 16 }}>
          <label className="gec-label">Responsável</label>
          {!delegando ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{memberName(task.responsavelId, team)}</span>
              {canManage && (
                <button className="gec-btn gec-btn-ghost" style={{ fontSize: 12, padding: "5px 9px" }} onClick={() => setDelegando(true)}>
                  <ArrowLeftRight size={12} /> Delegar
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select className="gec-select" value={delegadoPara} onChange={(e) => setDelegadoPara(e.target.value)}>
                <option value="">Escolher pessoa…</option>
                {assignableOptions.filter((m) => m.id !== task.responsavelId).map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
              <button className="gec-btn gec-btn-primary" style={{ fontSize: 12, padding: "8px 12px" }} disabled={!delegadoPara} onClick={confirmDelegate}>
                OK
              </button>
              <button className="gec-btn gec-btn-ghost" style={{ fontSize: 12, padding: "8px 10px" }} onClick={() => setDelegando(false)}>
                Cancelar
              </button>
            </div>
          )}
          {task.recorrencia && canManage && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              Delegar só troca o responsável desta ocorrência — as próximas voltam para quem a recorrência foi criada.
            </div>
          )}
        </div>

        {task.recorrencia && task.status !== "concluida" && (
          <button className="gec-btn gec-btn-ghost" style={{ fontSize: 12, padding: "6px 10px", marginBottom: 16 }} onClick={() => onStopRecurrence(task.id)}>
            Parar recorrência
          </button>
        )}

        {/* Checklist */}
        <div style={{ marginBottom: 18 }}>
          <label className="gec-label">
            <ListChecks size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Checklist {checklist.length > 0 && `(${checklistDone}/${checklist.length})`}
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {checklist.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={c.concluido} onChange={() => onToggleChecklistItem(c.id, !c.concluido)} />
                <span style={{ fontSize: 13, flex: 1, textDecoration: c.concluido ? "line-through" : "none", color: c.concluido ? "var(--muted)" : "var(--ink)" }}>
                  {c.texto}
                </span>
                <button className="gec-btn gec-btn-ghost" style={{ padding: 4 }} onClick={() => onDeleteChecklistItem(c.id)} aria-label="Remover item">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={submitChecklistItem} style={{ display: "flex", gap: 8 }}>
            <input className="gec-input" placeholder="Adicionar item…" value={novoItem} onChange={(e) => setNovoItem(e.target.value)} style={{ fontSize: 13 }} />
            <button type="submit" className="gec-btn gec-btn-ghost" disabled={!novoItem.trim()}>
              <Plus size={14} />
            </button>
          </form>
        </div>

        {/* Comentários */}
        <div style={{ marginBottom: 18 }}>
          <label className="gec-label">
            <MessageSquare size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Comentários
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            {comments.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nenhum comentário ainda.</div>}
            {comments.map((c) => (
              <div key={c.id} className="gec-card" style={{ padding: "9px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{memberName(c.autorId, team)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{fmtDateTime(c.createdAt)}</span>
                    {(c.autorId === currentUser.id || canManage) && (
                      <button className="gec-btn gec-btn-ghost" style={{ padding: 3 }} onClick={() => onDeleteComment(c.id)} aria-label="Remover comentário">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13 }}>{c.texto}</div>
              </div>
            ))}
          </div>
          <form onSubmit={submitComment} style={{ display: "flex", gap: 8 }}>
            <input className="gec-input" placeholder="Escrever um comentário…" value={novoComentario} onChange={(e) => setNovoComentario(e.target.value)} style={{ fontSize: 13 }} />
            <button type="submit" className="gec-btn gec-btn-ghost" disabled={!novoComentario.trim()}>
              <Plus size={14} />
            </button>
          </form>
        </div>

        {/* Anexos */}
        <div style={{ marginBottom: 18 }}>
          <label className="gec-label">
            <Paperclip size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Anexos
          </label>
          <AttachmentsSection task={task} attachments={attachments} canUpload onUpload={onUploadAttachment} onDelete={onDeleteAttachment} />
        </div>

        {/* Histórico */}
        <div>
          <label className="gec-label">
            <History size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Histórico
          </label>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Sem histórico ainda.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activity
                .slice()
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map((a) => (
                  <div key={a.id} style={{ fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{memberName(a.autorId, team)}</span> — {activityLabel(a)}
                    </span>
                    <span style={{ flexShrink: 0 }}>{fmtDateTime(a.createdAt)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Cartão de tarefa (usado no board em colunas) ----------
function TaskCard({ task, team, showResponsavel, canDelete, attachmentsCount, commentsCount, checklistProgress, onOpenDetail, onMoveStatus, onRequestConclude, onDelete }) {
  const critica = isAtrasada(task);
  const venceHoje = !critica && isVenceHoje(task);
  const cardStyle = critica
    ? { borderColor: "var(--danger)", background: "var(--danger-soft)" }
    : venceHoje
    ? { borderColor: "var(--warning)", background: "var(--warning-soft)" }
    : undefined;
  return (
    <div className="gec-task-card" style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{task.titulo}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {showResponsavel && <span>{memberName(task.responsavelId, team)}</span>}
        {showResponsavel && <span>·</span>}
        <span>{clinicaInfo(task.clinicaId).curto}</span>
        <span>·</span>
        <span className="gec-mono">prazo {fmtDate(task.prazo)}</span>
      </div>
      {(critica || task.prioridade !== "media" || task.categoria) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {critica && (
            <span className="gec-pill" style={{ background: "var(--danger)", color: "#fff" }}>
              <AlertTriangle size={11} /> Crítica
            </span>
          )}
          <PriorityPill prioridade={task.prioridade} />
          <CategoryTag categoria={task.categoria} />
        </div>
      )}
      {task.recorrencia && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--primary-dark)" }}>
          <Repeat size={11} /> {recurrenceLabel(task.recorrencia)}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* Tarefa recorrente já concluída não pode voltar pra pendente/andamento:
            reabrir e concluir de novo geraria uma segunda próxima ocorrência
            duplicada (a próxima já foi criada automaticamente na conclusão). */}
        {task.status !== "pendente" && !(task.recorrencia && task.status === "concluida") && (
          <button className="gec-btn gec-btn-ghost" style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => onMoveStatus(task, "pendente")}>
            ← Pendente
          </button>
        )}
        {task.status !== "em_andamento" && !(task.recorrencia && task.status === "concluida") && (
          <button className="gec-btn gec-btn-ghost" style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => onMoveStatus(task, "em_andamento")}>
            {task.status === "pendente" ? "Iniciar →" : "← Andamento"}
          </button>
        )}
        {task.status !== "concluida" && (
          <button className="gec-btn gec-btn-primary" style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => onRequestConclude(task)}>
            Concluir →
          </button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="gec-btn gec-btn-ghost" style={{ fontSize: 11.5, padding: "5px 9px", gap: 10 }} onClick={() => onOpenDetail(task)}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Paperclip size={12} /> {attachmentsCount}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><MessageSquare size={12} /> {commentsCount}</span>
          {checklistProgress && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><ListChecks size={12} /> {checklistProgress}</span>}
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="gec-btn gec-btn-ghost" style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => onOpenDetail(task)}>
            <Info size={12} /> Detalhes
          </button>
          {canDelete && (
            <button className="gec-btn gec-btn-danger" style={{ padding: 6 }} onClick={() => onDelete(task.id)} aria-label="Excluir tarefa">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Board em colunas (Pendente / Em andamento / Concluída) ----------
function TaskBoard({ team, tasks, attachmentsByTask, commentsByTask, checklistByTask, showResponsavel, canDelete, onMoveStatus, onRequestConclude, onDelete, onOpenDetail }) {
  return (
    <div className="gec-board">
      {STATUS_ORDER.map((statusKey) => {
        const colTasks = tasks
          .filter((t) => t.status === statusKey)
          .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
        return (
          <div key={statusKey} className="gec-column">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "0 2px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
                {STATUS[statusKey].label}
              </div>
              <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>{colTasks.length}</span>
            </div>
            {colTasks.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "16px 4px", textAlign: "center" }}>Nada aqui</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {colTasks.map((t) => {
                  const cl = checklistByTask[t.id] || [];
                  return (
                    <TaskCard
                      key={t.id}
                      task={t}
                      team={team}
                      showResponsavel={showResponsavel}
                      canDelete={canDelete}
                      attachmentsCount={(attachmentsByTask[t.id] || []).length}
                      commentsCount={(commentsByTask[t.id] || []).length}
                      checklistProgress={cl.length ? `${cl.filter((c) => c.concluido).length}/${cl.length}` : ""}
                      onOpenDetail={onOpenDetail}
                      onMoveStatus={onMoveStatus}
                      onRequestConclude={onRequestConclude}
                      onDelete={onDelete}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Tasks view (gestor: vê tudo · gerente: vê e gerencia só a própria clínica) ----------
function TasksView({
  team,
  tasks,
  assignableOptions,
  lockedClinicaId,
  hideClinicaFilter,
  attachmentsByTask,
  commentsByTask,
  checklistByTask,
  onCreate,
  onUpdateStatus,
  onDelete,
  onOpenDetail,
}) {
  const [showModal, setShowModal] = useState(false);
  const [filterClinica, setFilterClinica] = useState("todas");
  const [concludeTarget, setConcludeTarget] = useState(null);

  const filtered = tasks.filter((t) => filterClinica === "todas" || t.clinicaId === filterClinica);

  function handleMoveStatus(task, status) {
    onUpdateStatus(task.id, status);
  }
  async function handleConfirmConclude(task, file) {
    await onUpdateStatus(task.id, "concluida", file);
  }

  return (
    <>
      <div className="gec-fade-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {!hideClinicaFilter ? (
            <select className="gec-select" style={{ width: "auto" }} value={filterClinica} onChange={(e) => setFilterClinica(e.target.value)}>
              <option value="todas">Todas as clínicas</option>
              {CLINICAS.map((c) => (
                <option key={c.id} value={c.id}>{c.curto}</option>
              ))}
            </select>
          ) : (
            <div />
          )}
          <button className="gec-btn gec-btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} /> Nova tarefa
          </button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nenhuma tarefa por aqui" subtitle="Crie uma tarefa para começar a acompanhar a equipe." />
        ) : (
          <TaskBoard
            team={team}
            tasks={filtered}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            showResponsavel
            canDelete
            onMoveStatus={handleMoveStatus}
            onRequestConclude={setConcludeTarget}
            onDelete={onDelete}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>

      {showModal && (
        <NewTaskModal
          assignableOptions={assignableOptions}
          lockedClinicaId={lockedClinicaId}
          onClose={() => setShowModal(false)}
          onCreate={onCreate}
        />
      )}
      {concludeTarget && (
        <ConcludeModal task={concludeTarget} onClose={() => setConcludeTarget(null)} onConfirm={handleConfirmConclude} />
      )}
    </>
  );
}

// ---------- Minhas tarefas (papel base: recepção/comercial) ----------
function MyTasksView({ user, tasks, leads, assignableOptions, lockedClinicaId, attachmentsByTask, commentsByTask, checklistByTask, onUpdateStatus, onCreate, onOpenDetail, onOpenLead }) {
  const [showModal, setShowModal] = useState(false);
  const [concludeTarget, setConcludeTarget] = useState(null);
  const mine = tasks.filter((t) => t.responsavelId === user.id);
  // Follow-up/avaliação atrasados ou vencendo hoje já viram tarefa de
  // verdade sozinhos (ver o useEffect ao lado de handleGenerateFollowUpTask,
  // em PulsoApp) — esse aviso aqui é só uma rede de segurança pro instante
  // antes dela existir, então exclui os leads que já têm a tarefa real
  // correspondente, pra não duplicar o aviso.
  const temTarefaReal = (l) => tasks.some((t) => t.leadId === l.id && t.prazo === leadContatoRelevante(l));
  const meusFollowUpsHoje = (leads || []).filter((l) => l.responsavelComercial === user.id && isFollowUpHoje(l) && !temTarefaReal(l));
  const meusFollowUpsAtrasados = (leads || []).filter((l) => l.responsavelComercial === user.id && isFollowUpAtrasado(l) && !temTarefaReal(l));
  const leadItems = [
    ...meusFollowUpsAtrasados.map((l) => ({
      id: `l-${l.id}`,
      titulo: `${l.nomePaciente} · ${l.etapa === "avaliacao_agendada" ? "confirmar avaliação" : "follow-up"}`,
      prazo: leadContatoRelevante(l),
      tipo: "atrasada",
      subtitulo: null,
      onOpen: () => onOpenLead && onOpenLead(l),
    })),
    ...meusFollowUpsHoje.map((l) => ({
      id: `l-${l.id}`,
      titulo: `${l.nomePaciente} · ${l.etapa === "avaliacao_agendada" ? "confirmar avaliação" : "follow-up"}`,
      prazo: leadContatoRelevante(l),
      tipo: "followup",
      subtitulo: null,
      onOpen: () => onOpenLead && onOpenLead(l),
    })),
  ];

  function handleMoveStatus(task, status) {
    onUpdateStatus(task.id, status);
  }
  async function handleConfirmConclude(task, file) {
    await onUpdateStatus(task.id, "concluida", file);
  }

  return (
    <>
      <div className="gec-fade-in">
        <OverdueBanner tasks={mine} team={[]} onOpenTask={onOpenDetail} includeToday showResponsavel={false} extraItems={leadItems} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button className="gec-btn gec-btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} /> Nova tarefa
          </button>
        </div>
        {mine.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nenhuma tarefa atribuída" subtitle="Quando alguém criar uma tarefa pra você, ela aparece aqui." />
        ) : (
          <TaskBoard
            team={[]}
            tasks={mine}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            showResponsavel={false}
            canDelete={false}
            onMoveStatus={handleMoveStatus}
            onRequestConclude={setConcludeTarget}
            onDelete={() => {}}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
      {showModal && (
        <NewTaskModal
          assignableOptions={assignableOptions}
          lockedClinicaId={lockedClinicaId}
          defaultResponsavelId={user.id}
          onClose={() => setShowModal(false)}
          onCreate={onCreate}
        />
      )}
      {concludeTarget && (
        <ConcludeModal task={concludeTarget} onClose={() => setConcludeTarget(null)} onConfirm={handleConfirmConclude} />
      )}
    </>
  );
}

// ---------- Equipe (gestor, somente leitura por enquanto) ----------
function TeamView({ team }) {
  return (
    <div className="gec-fade-in" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="gec-card" style={{ padding: 18 }}>
        <div className="gec-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Equipe</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Adicionar ou remover alguém ainda é feito pelo painel do Supabase, fora do app.
        </div>
      </div>
      {team.length === 0 ? (
        <EmptyState icon={Users} title="Nenhuma funcionária cadastrada ainda" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {team.map((m) => (
            <div key={m.id} className="gec-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar nome={m.nome} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.nome}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {clinicaInfo(m.clinicaId).nome} · {roleLabel(m.role, m.clinicaId)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Kanban comercial: cartão de oportunidade ----------
function LeadCard({ lead, team, canDelete, onOpenDetail, onChangeStage, onDelete }) {
  const isGio = lead.clinicaId === "gio";
  // Fundo do card conforme o prazo de contato (follow-up ou avaliação, o que
  // valer pra etapa atual — ver leadContatoRelevante): atrasado em vermelho
  // leve, vencendo hoje em amarelo leve, futuro/sem data fica neutro.
  const atrasado = isFollowUpAtrasado(lead);
  const hoje = !atrasado && isFollowUpHoje(lead);
  const cardStyle = atrasado
    ? { borderColor: "var(--danger)", background: "var(--danger-soft)" }
    : hoje
    ? { borderColor: "var(--warning)", background: "var(--warning-soft)" }
    : undefined;
  return (
    <div className="gec-task-card" style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lead.nomePaciente}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
        {lead.whatsapp && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Phone size={11} /> {lead.whatsapp}
            {waLink(lead.whatsapp) && (
              <a
                href={waLink(lead.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ display: "inline-flex", color: "#25D366" }}
                title="Abrir conversa no WhatsApp"
                aria-label="Abrir conversa no WhatsApp"
              >
                <MessageCircle size={13} />
              </a>
            )}
          </span>
        )}
        <span>{memberName(lead.responsavelComercial, team)}</span>
        {!isGio && lead.codigoPaciente && <span>Código: {lead.codigoPaciente}</span>}
        {lead.procedimento && <span>{lead.procedimento}</span>}
      </div>
      {lead.etapa === "avaliacao_agendada" && lead.dataAvaliacao ? (
        <div
          style={{
            fontSize: 11.5,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontWeight: 600,
            color: isFollowUpAtrasado(lead) ? "var(--danger)" : "var(--primary-dark)",
          }}
        >
          <Calendar size={11} /> Avaliação: {fmtDate(lead.dataAvaliacao)}
          {isFollowUpAtrasado(lead) && " (confirmar!)"}
        </div>
      ) : (
        lead.proximoContato && (
          <div
            style={{
              fontSize: 11.5,
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontWeight: 600,
              color: isFollowUpAtrasado(lead) ? "var(--danger)" : "var(--primary-dark)",
            }}
          >
            <Calendar size={11} /> Follow-up: {fmtDate(lead.proximoContato)}
            {isFollowUpAtrasado(lead) && " (atrasado)"}
          </div>
        )
      )}
      {isGio && (lead.valorOrcado || lead.valorPago) && (
        <div style={{ fontSize: 11.5, display: "flex", gap: 8, color: "var(--primary-dark)" }}>
          {lead.valorOrcado && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <DollarSign size={11} /> orçado {fmtMoney(lead.valorOrcado)}
            </span>
          )}
          {lead.valorPago && <span>pago {fmtMoney(lead.valorPago)}</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isGio && lead.indicadoPorTecnicoId && (
          <span className="gec-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Stethoscope size={11} /> Indicação de {memberName(lead.indicadoPorTecnicoId, team)}
          </span>
        )}
        {isGio && lead.origem && (
          <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>
            <Tag size={11} /> {origemLabel(lead.origem)}
          </span>
        )}
      </div>
      <select
        className="gec-select"
        style={{ fontSize: 12, padding: "6px 8px" }}
        value={lead.etapa}
        onChange={(e) => onChangeStage(lead.id, e.target.value)}
      >
        {LEAD_STAGES.filter((s) => isGio || s.id !== "indicacao_recebida").map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="gec-btn gec-btn-ghost" style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => onOpenDetail(lead)}>
          <Info size={12} /> Detalhes
        </button>
        {canDelete && (
          <button className="gec-btn gec-btn-danger" style={{ padding: 6 }} onClick={() => onDelete(lead.id)} aria-label="Excluir oportunidade">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Kanban comercial: board horizontal com as 8 etapas ----------
function LeadBoard({ leads, team, canDelete, onOpenDetail, onChangeStage, onDelete, hideIndicacaoRecebida = false }) {
  const stages = hideIndicacaoRecebida ? LEAD_STAGES.filter((s) => s.id !== "indicacao_recebida") : LEAD_STAGES;
  return (
    <div className="gec-scrollbar" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
      {stages.map((stage) => {
        const stageLeads = leads
          .filter((l) => l.etapa === stage.id)
          .slice()
          .sort((a, b) => {
            if (stage.id === "avaliacao_agendada") {
              if (!a.dataAvaliacao && !b.dataAvaliacao) return 0;
              if (!a.dataAvaliacao) return 1;
              if (!b.dataAvaliacao) return -1;
              return a.dataAvaliacao < b.dataAvaliacao ? -1 : a.dataAvaliacao > b.dataAvaliacao ? 1 : 0;
            }
            if (!a.proximoContato && !b.proximoContato) return 0;
            if (!a.proximoContato) return 1;
            if (!b.proximoContato) return -1;
            return a.proximoContato < b.proximoContato ? -1 : a.proximoContato > b.proximoContato ? 1 : 0;
          });
        return (
          <div key={stage.id} className="gec-column" style={{ width: 250, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "0 2px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
                {stage.label}
              </div>
              <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>{stageLeads.length}</span>
            </div>
            {stageLeads.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "16px 4px", textAlign: "center" }}>Nada aqui</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stageLeads.map((l) => (
                  <LeadCard key={l.id} lead={l} team={team} canDelete={canDelete} onOpenDetail={onOpenDetail} onChangeStage={onChangeStage} onDelete={onDelete} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Kanban comercial: confirmação da data de follow-up ao salvar ----------
function FollowUpModal({ initialDate, onCancel, onConfirm }) {
  const [data, setData] = useState(initialDate || "");
  // Se a pessoa digitar uma data que já passou, pede uma segunda confirmação
  // em vez de deixar passar direto — evita criar sem querer um follow-up que
  // já nasce atrasado.
  const [confirmPast, setConfirmPast] = useState(false);
  const isPast = !!data && data < todayISO();

  function submit(e) {
    e.preventDefault();
    if (!data) return;
    if (isPast && !confirmPast) {
      setConfirmPast(true);
      return;
    }
    onConfirm(data);
  }
  return (
    <div className="gec-modal-overlay" onClick={onCancel}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <div className="gec-display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Próximo contato</div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Confirme ou ajuste a data do próximo follow-up antes de salvar a oportunidade.
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="gec-label">Data do follow-up</label>
            <input
              type="date"
              className="gec-input"
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setConfirmPast(false);
              }}
              required
              autoFocus
            />
          </div>
          {isPast && confirmPast && (
            <div style={{ fontSize: 12.5, color: "var(--danger)" }}>Essa data já passou — confirma mesmo assim?</div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="gec-btn gec-btn-ghost" onClick={onCancel}>Voltar</button>
            <button type="submit" className="gec-btn gec-btn-primary">
              {isPast && confirmPast ? "Confirmar mesmo assim" : "Confirmar e salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Kanban comercial: criar/editar oportunidade ----------
function LeadModal({ lead, clinicaId, team, currentUserId, canDelete, onClose, onSave, onDelete }) {
  const effectiveClinicaId = lead ? lead.clinicaId : clinicaId;
  const isGio = effectiveClinicaId === "gio";
  // Técnico não aparece como opção de responsável comercial (não acompanha o
  // funil, só registra indicação).
  const clinicTeam = team.filter((m) => m.role !== "tecnico" && (m.clinicaId === effectiveClinicaId || m.role === "owner"));

  const [nomePaciente, setNomePaciente] = useState(lead?.nomePaciente || "");
  const [codigoPaciente, setCodigoPaciente] = useState(lead?.codigoPaciente || "");
  const [whatsapp, setWhatsapp] = useState(lead?.whatsapp || "");
  const [responsavelComercial, setResponsavelComercial] = useState(lead?.responsavelComercial || currentUserId || "");
  const [procedimento, setProcedimento] = useState(lead?.procedimento || "");
  const [etapa, setEtapa] = useState(lead?.etapa || "avaliacao_agendada");
  const [dataAvaliacao, setDataAvaliacao] = useState(lead?.dataAvaliacao || "");
  const [proximoContato, setProximoContato] = useState(lead?.proximoContato || "");
  const [origem, setOrigem] = useState(lead?.origem || "");
  const [indicadoPor, setIndicadoPor] = useState(lead?.indicadoPor || "");
  const [valorOrcado, setValorOrcado] = useState(lead?.valorOrcado ?? "");
  const [valorPago, setValorPago] = useState(lead?.valorPago ?? "");
  const [historia, setHistoria] = useState(lead?.historia || "");
  const [evolucao, setEvolucao] = useState(lead?.evolucao || "");
  const [observacoes, setObservacoes] = useState(lead?.observacoes || "");
  const [submitting, setSubmitting] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [error, setError] = useState("");
  // Se a "Data da avaliação" digitada já passou, pede uma segunda
  // confirmação antes de salvar (evita criar sem querer uma oportunidade
  // que já nasce atrasada).
  const [confirmPastAvaliacao, setConfirmPastAvaliacao] = useState(false);
  const isPastAvaliacao = !!dataAvaliacao && dataAvaliacao < todayISO();

  function buildPatch(followUpDate) {
    const full = {
      clinicaId: effectiveClinicaId,
      nomePaciente: nomePaciente.trim(),
      whatsapp: whatsapp.trim(),
      responsavelComercial: responsavelComercial || null,
      procedimento: procedimento.trim(),
      etapa,
      dataAvaliacao: dataAvaliacao || null,
      proximoContato: followUpDate || null,
      codigoPaciente: !isGio ? codigoPaciente.trim() : null,
      historia: !isGio ? historia.trim() : null,
      evolucao: !isGio ? evolucao.trim() : null,
      observacoes: isGio ? observacoes.trim() : null,
      origem: isGio ? origem || null : null,
      indicadoPor: isGio && origem === "indicacao" ? indicadoPor.trim() : null,
      valorOrcado: isGio && valorOrcado !== "" ? Number(valorOrcado) : null,
      valorPago: isGio && valorPago !== "" ? Number(valorPago) : null,
    };
    // Oportunidade nova: não existe "original" pra comparar, manda tudo.
    if (!lead) return full;
    // Edição: manda só o que realmente mudou na tela, pra não sobrescrever por
    // cima de uma alteração concorrente feita por outra pessoa enquanto o
    // modal estava aberto (ex: alguém arrastou o card no kanban nesse meio
    // tempo) — segue o mesmo princípio de "omitir, não zerar" usado em outros
    // pontos do app.
    const diff = {};
    for (const key in full) {
      if (full[key] !== (lead[key] ?? null)) diff[key] = full[key];
    }
    return diff;
  }

  async function finish(patch) {
    setSubmitting(true);
    setError("");
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      // Mantém o modal aberto com o que já foi digitado (ex: código de
      // paciente repetido) em vez de fechar como se tivesse dado certo.
      setSubmitting(false);
      setShowFollowUp(false);
      setError(err.message || "Não foi possível salvar a oportunidade. Tente de novo.");
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    if (!nomePaciente.trim()) return;
    if (etapa === "fechado" || etapa === "perdido") {
      // Fechado/perdido: não vamos mais entrar em contato, então não faz sentido pedir follow-up
      // (e qualquer follow-up que já existisse é limpo, pra não sobrar data velha nesses cards).
      finish(buildPatch(null));
    } else if (etapa === "avaliacao_agendada") {
      if (isPastAvaliacao && !confirmPastAvaliacao) {
        setConfirmPastAvaliacao(true);
        return;
      }
      // Nessa etapa o follow-up é sempre a própria data da avaliação: nesse dia a equipe
      // tem que confirmar se o paciente veio e tentar reagendar caso tenha faltado.
      finish(buildPatch(dataAvaliacao || null));
    } else if (lead) {
      // Editando uma oportunidade existente: sempre confirma a data de follow-up antes de salvar.
      setShowFollowUp(true);
    } else {
      // Oportunidade nova: ainda não faz sentido ter follow-up, isso é definido na primeira edição.
      finish(buildPatch(null));
    }
  }

  if (showFollowUp) {
    return (
      <FollowUpModal
        initialDate={proximoContato}
        onCancel={() => setShowFollowUp(false)}
        onConfirm={(date) => {
          setProximoContato(date);
          finish(buildPatch(date));
        }}
      />
    );
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>{lead ? "Editar oportunidade" : "Nova oportunidade"}</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleFormSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{clinicaInfo(effectiveClinicaId).curto}</div>
          <div>
            <label className="gec-label">Nome do paciente</label>
            <input className="gec-input" value={nomePaciente} onChange={(e) => setNomePaciente(e.target.value)} required />
          </div>
          {!isGio && (
            <div>
              <label className="gec-label">Código do paciente</label>
              <input className="gec-input" value={codigoPaciente} onChange={(e) => setCodigoPaciente(e.target.value)} />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="gec-label">WhatsApp</label>
              <input className="gec-input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(51) 9…" />
            </div>
            <div>
              <label className="gec-label">Responsável comercial</label>
              <select className="gec-select" value={responsavelComercial} onChange={(e) => setResponsavelComercial(e.target.value)}>
                <option value="">—</option>
                {clinicTeam.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="gec-label">Etapa</label>
              <select className="gec-select" value={etapa} onChange={(e) => setEtapa(e.target.value)}>
                {LEAD_STAGES.filter((s) => isGio || s.id !== "indicacao_recebida").map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="gec-label">Data da avaliação</label>
              <input
                type="date"
                className="gec-input"
                value={dataAvaliacao || ""}
                onChange={(e) => {
                  setDataAvaliacao(e.target.value);
                  setConfirmPastAvaliacao(false);
                }}
              />
            </div>
          </div>
          {etapa === "avaliacao_agendada" && isPastAvaliacao && confirmPastAvaliacao && (
            <div style={{ fontSize: 12.5, color: "var(--danger)" }}>Essa data já passou — confirma mesmo assim?</div>
          )}
          {lead && (
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              Próximo contato atual: {lead.proximoContato ? fmtDate(lead.proximoContato) : "não definido"} — você confirma isso ao salvar.
            </div>
          )}
          <div>
            <label className="gec-label">{isGio ? "Procedimento/tratamento de interesse" : "Procedimento prioritário"}</label>
            <input className="gec-input" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} />
          </div>

          {isGio && (
            <>
              {lead?.indicadoPorTecnicoId && (
                <div style={{ fontSize: 12, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 8, padding: "8px 10px" }}>
                  <Stethoscope size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                  Indicação de {memberName(lead.indicadoPorTecnicoId, team)}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: origem === "indicacao" ? "1fr 1fr" : "1fr", gap: 12 }}>
                <div>
                  <label className="gec-label">Origem</label>
                  <select className="gec-select" value={origem} onChange={(e) => setOrigem(e.target.value)}>
                    <option value="">—</option>
                    {ORIGENS_LEAD.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {origem === "indicacao" && (
                  <div>
                    <label className="gec-label">Quem indicou</label>
                    <input className="gec-input" value={indicadoPor} onChange={(e) => setIndicadoPor(e.target.value)} />
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="gec-label">Valor orçado (R$)</label>
                  <input type="number" step="0.01" min="0" className="gec-input" value={valorOrcado} onChange={(e) => setValorOrcado(e.target.value)} />
                </div>
                <div>
                  <label className="gec-label">Valor pago (R$)</label>
                  <input type="number" step="0.01" min="0" className="gec-input" value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="gec-label">Observações</label>
                <textarea className="gec-textarea" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
              </div>
              {lead && (
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Oportunidade criada em {fmtDate(lead.criadoEm?.slice(0, 10))}</div>
              )}
            </>
          )}

          {!isGio && (
            <div>
              <label className="gec-label">História</label>
              <textarea className="gec-textarea" rows={3} value={historia} onChange={(e) => setHistoria(e.target.value)} />
            </div>
          )}

          {!isGio && (
            <div>
              <label className="gec-label">Evolução</label>
              <textarea className="gec-textarea" rows={3} value={evolucao} onChange={(e) => setEvolucao(e.target.value)} placeholder="Tratativas do pós-venda..." />
            </div>
          )}

          {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="submit" className="gec-btn gec-btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
              {submitting
                ? "Salvando…"
                : etapa === "avaliacao_agendada" && isPastAvaliacao && confirmPastAvaliacao
                ? "Confirmar mesmo assim"
                : lead
                ? "Salvar"
                : "Criar oportunidade"}
            </button>
            {lead && canDelete && (
              <button type="button" className="gec-btn gec-btn-danger" onClick={() => { onDelete(lead.id); onClose(); }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Importar avaliações da Sorridents a partir do relatório de agendas (Excel) ----------
function ImportLeadsModal({ onImport, onClose }) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setParsing(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
        const parsed = parseAgendaRows(rows);
        if (parsed.rows.length === 0) {
          setError('Não encontrei linhas válidas nesse arquivo (procurei as colunas "Cod. Pac.", "Nome Paciente" e "Data Consulta").');
          setParsing(false);
          return;
        }
        const summary = await onImport(parsed.rows);
        const base = summary
          ? { ...summary, total: parsed.rows.length }
          : { criados: 0, ignorados: parsed.rows.length, total: parsed.rows.length };
        setResult({ ...base, missing: parsed.missing });
      } catch (err) {
        setError("Não consegui ler esse arquivo. Confirme que é o relatório de agendas exportado do sistema (.xls).");
      } finally {
        setParsing(false);
        e.target.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>Importar avaliações</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
          Suba o relatório de agendas (.xls) exportado do sistema. Cada avaliação vira uma oportunidade em "Avaliação agendada", com código, nome e WhatsApp do paciente já preenchidos. Pacientes cujo código já existe no comercial são ignorados automaticamente, pra não duplicar.
        </p>
        <input type="file" accept=".xls,.xlsx" onChange={handleFile} disabled={parsing} />
        {parsing && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Importando…</div>}
        {error && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 10 }}>{error}</div>}
        {result && (
          <div style={{ fontSize: 12.5, marginTop: 10 }}>
            {result.criados} oportunidade{result.criados === 1 ? "" : "s"} criada{result.criados === 1 ? "" : "s"}
            {result.ignorados > 0 ? `, ${result.ignorados} já existia${result.ignorados === 1 ? "" : "m"} e foi${result.ignorados === 1 ? "" : "ram"} ignorada${result.ignorados === 1 ? "" : "s"}` : ""}.
            {result.missing && result.missing.length > 0 && (
              <div style={{ color: "var(--danger)", marginTop: 6 }}>
                Atenção: não encontrei a coluna "{result.missing.join('" nem "')}" nesse arquivo — {result.missing.length === 1 ? "esse campo" : "esses campos"} {result.missing.length === 1 ? "ficou" : "ficaram"} em branco em todas as linhas importadas. Confira se o cabeçalho do relatório mudou.
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="gec-btn gec-btn-primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Comercial (kanban de leads/oportunidades) ----------
function ComercialView({ leads, team, lockedClinicaId, currentUserId, canDelete, onCreate, onImport, onDelete, onChangeStage, onOpenDetail }) {
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filterClinica, setFilterClinica] = useState("todas");

  const filtered = leads.filter((l) => (lockedClinicaId ? l.clinicaId === lockedClinicaId : filterClinica === "todas" || l.clinicaId === filterClinica));
  const modalClinica = lockedClinicaId || (filterClinica === "todas" ? CLINICAS[0].id : filterClinica);
  const isSorridentsView = lockedClinicaId ? lockedClinicaId === "sorridents" : filterClinica === "sorridents";

  return (
    <>
      <div className="gec-fade-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {!lockedClinicaId ? (
            <select className="gec-select" style={{ width: "auto" }} value={filterClinica} onChange={(e) => setFilterClinica(e.target.value)}>
              <option value="todas">Todas as clínicas</option>
              {CLINICAS.map((c) => (
                <option key={c.id} value={c.id}>{c.curto}</option>
              ))}
            </select>
          ) : (
            <div />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {isSorridentsView && (
              <button className="gec-btn gec-btn-ghost" onClick={() => setShowImport(true)}>
                <Upload size={15} /> Importar planilha
              </button>
            )}
            <button className="gec-btn gec-btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} /> Nova oportunidade
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Briefcase} title="Nenhuma oportunidade por aqui" subtitle="Crie a primeira oportunidade pra começar o funil." />
        ) : (
          <LeadBoard leads={filtered} team={team} canDelete={canDelete} onOpenDetail={onOpenDetail} onChangeStage={onChangeStage} onDelete={onDelete} hideIndicacaoRecebida={isSorridentsView} />
        )}
      </div>

      {showModal && (
        <LeadModal
          clinicaId={modalClinica}
          team={team}
          currentUserId={currentUserId}
          canDelete={canDelete}
          onClose={() => setShowModal(false)}
          onSave={(patch) => onCreate(patch)}
          onDelete={onDelete}
        />
      )}

      {showImport && <ImportLeadsModal onImport={onImport} onClose={() => setShowImport(false)} />}
    </>
  );
}

// ---------- Indicações do time técnico (GIO): formulário ----------
function IndicacaoForm({ onCreate }) {
  const [nomePaciente, setNomePaciente] = useState("");
  const [procedimento, setProcedimento] = useState("");
  const [observacao, setObservacao] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!nomePaciente.trim() || !procedimento.trim()) return;
    setSubmitting(true);
    await onCreate({ nomePaciente: nomePaciente.trim(), procedimento: procedimento.trim(), observacao: observacao.trim() });
    setSubmitting(false);
    setNomePaciente("");
    setProcedimento("");
    setObservacao("");
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  }

  return (
    <form onSubmit={submit} className="gec-card" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 18, marginBottom: 20 }}>
      <div>
        <div className="gec-display" style={{ fontSize: 15, fontWeight: 600 }}>Nova indicação</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          A data é registrada automaticamente com o dia de hoje. Ao enviar, a recepção já recebe uma tarefa pra ligar pra esse paciente.
        </div>
      </div>
      <div>
        <label className="gec-label">Nome do paciente</label>
        <input className="gec-input" value={nomePaciente} onChange={(e) => setNomePaciente(e.target.value)} required />
      </div>
      <div>
        <label className="gec-label">Procedimento indicado</label>
        <input className="gec-input" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} required />
      </div>
      <div>
        <label className="gec-label">Observação (opcional)</label>
        <textarea className="gec-textarea" rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      <button type="submit" className="gec-btn gec-btn-primary" style={{ justifyContent: "center" }} disabled={submitting}>
        {submitting ? "Enviando…" : sent ? "Indicação enviada ✓" : "Enviar indicação"}
      </button>
    </form>
  );
}

// ---------- Indicações do time técnico (GIO): histórico ----------
function IndicacaoRow({ indicacao, lead }) {
  const stage = lead ? LEAD_STAGES.find((s) => s.id === lead.etapa) : null;
  return (
    <div className="gec-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{indicacao.nomePaciente}</div>
        <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(indicacao.dataIndicacao)}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{indicacao.procedimento}</div>
      {indicacao.observacao && <div style={{ fontSize: 12, color: "var(--muted)" }}>{indicacao.observacao}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {stage && (
          <span className="gec-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            {stage.label}
          </span>
        )}
        {lead?.valorPago && (
          <span className="gec-pill" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            <DollarSign size={11} /> Pago: {fmtMoney(lead.valorPago)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Indicações do time técnico (GIO): mini dashboard do mês ----------
function IndicacoesDashboard({ indicacoes, leadsById }) {
  const mesAtual = todayISO().slice(0, 7);
  const doMes = indicacoes.filter((i) => (i.dataIndicacao || "").slice(0, 7) === mesAtual);
  const totalPago = doMes.reduce((sum, i) => sum + (Number(leadsById[i.leadId]?.valorPago) || 0), 0);
  return (
    <div className="gec-card" style={{ padding: 16, marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Indicações este mês</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700 }}>{doMes.length}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Pago este mês</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>{fmtMoney(totalPago) || "R$ 0,00"}</div>
      </div>
    </div>
  );
}

// ---------- Indicações do time técnico (GIO): tela principal ----------
function IndicacoesView({ indicacoes, leads, onCreate }) {
  const leadsById = {};
  leads.forEach((l) => {
    leadsById[l.id] = l;
  });
  return (
    <div className="gec-fade-in">
      <IndicacaoForm onCreate={onCreate} />
      <IndicacoesDashboard indicacoes={indicacoes} leadsById={leadsById} />
      <div className="gec-display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Suas indicações</div>
      {indicacoes.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhuma indicação enviada ainda" subtitle="As indicações que você enviar aparecem aqui." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {indicacoes.map((i) => (
            <IndicacaoRow key={i.id} indicacao={i} lead={leadsById[i.leadId]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Cobranças (boleto/recorrente) da GIO: cadastrar/editar ----------
function CobrancaModal({ cobranca, onClose, onSave, onDelete, canDelete }) {
  const [nomeCliente, setNomeCliente] = useState(cobranca?.nomeCliente || "");
  const [whatsapp, setWhatsapp] = useState(cobranca?.whatsapp || "");
  const [formaPagamento, setFormaPagamento] = useState(cobranca?.formaPagamento || "recorrente");
  const [diaVencimento, setDiaVencimento] = useState(cobranca?.diaVencimento ?? "");
  const [valorParcela, setValorParcela] = useState(cobranca?.valorParcela ?? "");
  const [numeroParcelas, setNumeroParcelas] = useState(cobranca?.numeroParcelas ?? 1);
  const [parcelasPagas, setParcelasPagas] = useState(cobranca?.parcelasPagas ?? 0);
  const [observacoes, setObservacoes] = useState(cobranca?.observacoes || "");
  const [ativo, setAtivo] = useState(cobranca?.ativo ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!nomeCliente.trim() || !diaVencimento) return;
    const full = {
      nomeCliente: nomeCliente.trim(),
      whatsapp: whatsapp.trim(),
      formaPagamento,
      diaVencimento: Number(diaVencimento),
      valorParcela: valorParcela !== "" ? Number(valorParcela) : null,
      numeroParcelas: Math.max(1, Number(numeroParcelas) || 1),
      parcelasPagas: Math.max(0, Number(parcelasPagas) || 0),
      observacoes: observacoes.trim(),
      ativo,
    };
    setSubmitting(true);
    setError("");
    try {
      if (!cobranca) {
        await onSave(full);
      } else {
        // Edição: manda só o que mudou, pra não sobrescrever por cima de uma
        // tarefa que a automação tenha acabado de gerar (ela também mexe em
        // parcelas_pagas/ativo) enquanto o modal estava aberto.
        const diff = {};
        for (const key in full) {
          if (full[key] !== (cobranca[key] ?? (typeof full[key] === "string" ? "" : full[key]))) diff[key] = full[key];
        }
        await onSave(diff);
      }
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(err.message || "Não foi possível salvar a cobrança. Tente de novo.");
    }
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>{cobranca ? "Editar cobrança" : "Nova cobrança"}</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="gec-label">Nome do cliente</label>
            <input className="gec-input" value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="gec-label">WhatsApp (opcional)</label>
            <input className="gec-input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(51) 9…" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="gec-label">Forma de pagamento</label>
              <select className="gec-select" value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
                <option value="recorrente">Recorrente no cartão</option>
                <option value="boleto">Boleto</option>
              </select>
            </div>
            <div>
              <label className="gec-label">Dia de vencimento</label>
              <input type="number" min="1" max="31" className="gec-input" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} required />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="gec-label">Valor da parcela (R$)</label>
              <input type="number" step="0.01" min="0" className="gec-input" value={valorParcela} onChange={(e) => setValorParcela(e.target.value)} />
            </div>
            <div>
              <label className="gec-label">Nº de parcelas</label>
              <input type="number" min="1" className="gec-input" value={numeroParcelas} onChange={(e) => setNumeroParcelas(e.target.value)} />
            </div>
            <div>
              <label className="gec-label">Parcelas já pagas</label>
              <input type="number" min="0" className="gec-input" value={parcelasPagas} onChange={(e) => setParcelasPagas(e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            A cada vencimento, o Pulso cria a tarefa de cobrança automaticamente e avança essa contagem sozinho — só mexe aqui se precisar corrigir algo manualmente.
          </div>
          <div>
            <label className="gec-label">Observações (opcional)</label>
            <textarea className="gec-textarea" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>
          {cobranca && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              <span style={{ fontSize: 13 }}>Cobrança ativa (gera tarefa automaticamente)</span>
            </label>
          )}
          {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="submit" className="gec-btn gec-btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Salvando…" : cobranca ? "Salvar" : "Cadastrar cobrança"}
            </button>
            {cobranca && canDelete && (
              <button type="button" className="gec-btn gec-btn-danger" onClick={() => { onDelete(cobranca.id); onClose(); }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function COBRANCA_LABEL(formaPagamento) {
  return formaPagamento === "boleto" ? "Boleto" : "Recorrente";
}

// ---------- Cobranças da GIO: linha de um cliente ----------
function CobrancaRow({ cobranca, onEdit, tarefaAtual, onMarkPaid, onUndoPaid }) {
  // Mesma cor de fundo das tarefas/leads, olhando a tarefa de cobrança do
  // ciclo atual: atrasada (venceu e ainda não foi gerada/concluída) fica
  // vermelho leve, vencendo hoje fica amarelo leve, senão neutro — inclusive
  // quando ainda não existe tarefa pra essa cobrança (nada vencendo agora).
  const atrasada = !!tarefaAtual && isAtrasada(tarefaAtual);
  const venceHoje = !atrasada && !!tarefaAtual && isVenceHoje(tarefaAtual);
  const corStatus = atrasada
    ? { borderColor: "var(--danger)", background: "var(--danger-soft)" }
    : venceHoje
    ? { borderColor: "var(--warning)", background: "var(--warning-soft)" }
    : {};
  return (
    <div
      className="gec-card"
      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, opacity: cobranca.ativo ? 1 : 0.6, cursor: "pointer", ...corStatus }}
      onClick={() => onEdit(cobranca)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{cobranca.nomeCliente}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!cobranca.ativo && (
            <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>Inativa</span>
          )}
          <span className="gec-pill" style={{ background: "var(--primary-soft)", color: "var(--primary-dark)" }}>
            <CreditCard size={11} /> {COBRANCA_LABEL(cobranca.formaPagamento)} · dia {cobranca.diaVencimento}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
        {cobranca.whatsapp && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Phone size={11} /> {cobranca.whatsapp}
            {waLink(cobranca.whatsapp) && (
              <a
                href={waLink(cobranca.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ display: "inline-flex", color: "#25D366" }}
                title="Abrir conversa no WhatsApp"
                aria-label="Abrir conversa no WhatsApp"
              >
                <MessageCircle size={13} />
              </a>
            )}
          </span>
        )}
        <span>
          {cobranca.valorParcela ? fmtMoney(cobranca.valorParcela) : "—"} · parcela {cobranca.parcelasPagas} de {cobranca.numeroParcelas}
        </span>
        {cobranca.observacoes && <span>{cobranca.observacoes}</span>}
      </div>
      {tarefaAtual && tarefaAtual.status !== "concluida" && onMarkPaid && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <span className="gec-pill" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
            Aguardando confirmação de pagamento
          </span>
          <button
            className="gec-btn gec-btn-primary"
            style={{ fontSize: 11.5, padding: "5px 9px" }}
            onClick={(e) => {
              e.stopPropagation();
              onMarkPaid(tarefaAtual.id);
            }}
          >
            <CheckCircle2 size={12} /> Marcar como paga
          </button>
        </div>
      )}
      {tarefaAtual && tarefaAtual.status === "concluida" && onUndoPaid && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <span className="gec-pill" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            <CheckCircle2 size={11} /> Paga
          </span>
          <button
            className="gec-btn gec-btn-ghost"
            style={{ fontSize: 11.5, padding: "5px 9px" }}
            onClick={(e) => {
              e.stopPropagation();
              onUndoPaid(tarefaAtual.id);
            }}
          >
            <Undo2 size={12} /> Desfazer
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Cobranças da GIO: mini dashboard com visão geral ----------
function CobrancasDashboard({ cobrancas }) {
  const hoje = todayISO();
  const ativas = cobrancas.filter((c) => c.ativo);
  const totalEsperadoMes = ativas.reduce((sum, c) => sum + (Number(c.valorParcela) || 0), 0);
  const boletos = ativas.filter((c) => c.formaPagamento === "boleto").length;
  const recorrentes = ativas.length - boletos;
  const vencendoEmBreve = ativas.filter((c) => {
    const venc = dueDateThisCycle(c.diaVencimento, hoje);
    const diff = daysBetweenISO(hoje, venc);
    return diff >= 0 && diff <= 7;
  }).length;
  const vencendoHoje = ativas.filter((c) => dueDateThisCycle(c.diaVencimento, hoje) === hoje).length;
  // "Em atraso": o vencimento desse ciclo já passou e a cobrança ainda não
  // gerou a tarefa correspondente (senão parcelasPagas já teria avançado) —
  // sinaliza um caso que a checagem automática ainda não pegou (app não foi
  // aberto a tempo, ou já passou da janela de tolerância de 6 dias).
  const emAtraso = ativas.filter((c) => daysBetweenISO(hoje, dueDateThisCycle(c.diaVencimento, hoje)) < 0).length;

  return (
    <div className="gec-card" style={{ padding: 16, marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Cobranças ativas</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700 }}>{ativas.length}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Esperado este mês</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>{fmtMoney(totalEsperadoMes) || "R$ 0,00"}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Boleto / Recorrente</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700 }}>{boletos} / {recorrentes}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Vencendo hoje</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700, color: vencendoHoje > 0 ? "var(--warning)" : "inherit" }}>{vencendoHoje}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Em atraso</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700, color: emAtraso > 0 ? "var(--danger)" : "inherit" }}>{emAtraso}</div>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>Vencendo em 7 dias</div>
        <div className="gec-display" style={{ fontSize: 22, fontWeight: 700, color: vencendoEmBreve > 0 ? "var(--warning)" : "inherit" }}>{vencendoEmBreve}</div>
      </div>
    </div>
  );
}

// ---------- Cobranças da GIO: lista ----------
function CobrancasView({ cobrancas, tasks, canDelete, onCreate, onUpdate, onDelete, onMarkPaid, onUndoPaid }) {
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const ordenadas = [...cobrancas].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return (a.diaVencimento || 0) - (b.diaVencimento || 0);
  });

  // Pra cada cobrança, a tarefa de cobrança do ciclo mais recente (qualquer
  // status) — dá o botão "Marcar como paga" (se ainda pendente) ou "Desfazer"
  // (se já foi marcada) direto no card, sem precisar abrir a tarefa.
  function tarefaAtual(cobrancaId) {
    const doCliente = (tasks || []).filter((t) => t.cobrancaId === cobrancaId).sort((a, b) => (b.prazo || "").localeCompare(a.prazo || ""));
    return doCliente[0] || null;
  }

  return (
    <div className="gec-fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 480 }}>
          Cadastro dos clientes em boleto ou cartão recorrente. O Pulso cria sozinho a tarefa de cobrança pra gerente da GIO perto de cada vencimento.
        </div>
        <button className="gec-btn gec-btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={15} /> Nova cobrança
        </button>
      </div>

      <CobrancasDashboard cobrancas={cobrancas} />

      {ordenadas.length === 0 ? (
        <EmptyState icon={CreditCard} title="Nenhuma cobrança cadastrada ainda" subtitle="Cadastre um cliente em boleto ou recorrente pra começar o controle." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ordenadas.map((c) => (
            <CobrancaRow key={c.id} cobranca={c} onEdit={setEditTarget} tarefaAtual={tarefaAtual(c.id)} onMarkPaid={onMarkPaid} onUndoPaid={onUndoPaid} />
          ))}
        </div>
      )}

      {showModal && (
        <CobrancaModal onClose={() => setShowModal(false)} onSave={(patch) => onCreate(patch)} canDelete={canDelete} />
      )}
      {editTarget && (
        <CobrancaModal
          cobranca={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={(patch) => onUpdate(editTarget.id, patch)}
          onDelete={onDelete}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}

// ---------- Estoque: linha de um item ----------
function EstoqueItemRow({ item, canManage, onDelta, onEdit }) {
  const faltando = quantoComprar(item);
  const abaixoIdeal = item.quantidadeAtual < item.quantidadeIdeal;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: canManage ? "1fr 90px 140px 90px 32px" : "1fr 90px 140px",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        background: abaixoIdeal ? "var(--warning-soft)" : "transparent",
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{item.nome}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center" }}>{fmtQty(item.quantidadeIdeal)}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <button className="gec-btn gec-btn-ghost" style={{ padding: 5 }} onClick={() => onDelta(item, -1)} aria-label="Diminuir quantidade">
          <Minus size={13} />
        </button>
        <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 28, textAlign: "center" }}>{fmtQty(item.quantidadeAtual)}</span>
        <button className="gec-btn gec-btn-ghost" style={{ padding: 5 }} onClick={() => onDelta(item, 1)} aria-label="Aumentar quantidade">
          <Plus size={13} />
        </button>
      </div>
      {canManage && (
        <div style={{ fontSize: 13, textAlign: "center", fontWeight: faltando > 0 ? 700 : 400, color: faltando > 0 ? "var(--danger)" : "var(--muted)" }}>
          {faltando > 0 ? fmtQty(faltando) : "—"}
        </div>
      )}
      {canManage && (
        <button className="gec-btn gec-btn-ghost" style={{ padding: 5 }} onClick={() => onEdit(item)} aria-label="Editar item">
          <Info size={13} />
        </button>
      )}
    </div>
  );
}

// ---------- Estoque: seção colapsável por categoria ----------
function EstoqueCategoriaSection({ categoria, itens, canManage, expanded, onToggle, onDelta, onEdit }) {
  const faltandoCount = itens.filter((i) => quantoComprar(i) > 0).length;
  return (
    <div className="gec-card" style={{ marginBottom: 12, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChevronDown size={16} style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s ease", color: "var(--muted)" }} />
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{categoria}</span>
          <span className="gec-pill" style={{ background: "#EAEDEA", color: "var(--muted)" }}>{itens.length}</span>
        </div>
        {faltandoCount > 0 && (
          <span className="gec-pill" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
            {faltandoCount} pra comprar
          </span>
        )}
      </button>
      {expanded && (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: canManage ? "1fr 90px 140px 90px 32px" : "1fr 90px 140px",
              gap: 10,
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".03em",
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div>Item</div>
            <div style={{ textAlign: "center" }}>Ideal</div>
            <div style={{ textAlign: "center" }}>Atual</div>
            {canManage && <div style={{ textAlign: "center" }}>Comprar</div>}
            {canManage && <div />}
          </div>
          {itens.map((item) => (
            <EstoqueItemRow key={item.id} item={item} canManage={canManage} onDelta={onDelta} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Estoque: criar/editar item ----------
const NOVA_CATEGORIA = "__nova__";

function EstoqueItemModal({ item, clinicaId, tipo, categoriasExistentes, onClose, onSave, onDelete }) {
  const [nome, setNome] = useState(item?.nome || "");
  const [categoria, setCategoria] = useState(
    item?.categoria || (categoriasExistentes.length > 0 ? categoriasExistentes[0] : NOVA_CATEGORIA)
  );
  const [novaCategoria, setNovaCategoria] = useState("");
  const [quantidadeIdeal, setQuantidadeIdeal] = useState(item?.quantidadeIdeal ?? "");
  const [quantidadeAtual, setQuantidadeAtual] = useState(item?.quantidadeAtual ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    const categoriaFinal = categoria === NOVA_CATEGORIA ? novaCategoria.trim() : categoria;
    if (!categoriaFinal) return;
    const full = {
      clinicaId,
      tipo: tipo || "clinico",
      nome: nome.trim(),
      categoria: categoriaFinal,
      quantidadeIdeal: Number(quantidadeIdeal) || 0,
      quantidadeAtual: Number(quantidadeAtual) || 0,
    };
    setSubmitting(true);
    if (!item) {
      // Item novo: não existe "original" pra comparar, manda tudo.
      await onSave(full);
    } else {
      // Edição: manda só o que realmente mudou na tela, pra não sobrescrever
      // por cima de uma contagem feita por outra pessoa nos botões +/- do
      // estoque enquanto esse modal estava aberto.
      const diff = {};
      for (const key in full) {
        if (full[key] !== item[key]) diff[key] = full[key];
      }
      await onSave(diff);
    }
    setSubmitting(false);
    onClose();
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>{item ? "Editar item" : "Novo item"}</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="gec-label">Nome do item</label>
            <input className="gec-input" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="gec-label">Categoria</label>
            <select className="gec-select" value={categoria} onChange={(e) => setCategoria(e.target.value)} required>
              {categoriasExistentes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={NOVA_CATEGORIA}>+ Nova categoria</option>
            </select>
            {categoria === NOVA_CATEGORIA && (
              <input
                className="gec-input"
                style={{ marginTop: 8 }}
                placeholder="Nome da nova categoria"
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                required
                autoFocus
              />
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="gec-label">Quantidade ideal</label>
              <input type="number" step="1" min="0" className="gec-input" value={quantidadeIdeal} onChange={(e) => setQuantidadeIdeal(e.target.value)} />
            </div>
            <div>
              <label className="gec-label">Quantidade atual</label>
              <input type="number" step="1" min="0" className="gec-input" value={quantidadeAtual} onChange={(e) => setQuantidadeAtual(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="submit" className="gec-btn gec-btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Salvando…" : item ? "Salvar" : "Adicionar item"}
            </button>
            {item && (
              <button
                type="button"
                className="gec-btn gec-btn-danger"
                onClick={() => {
                  onDelete(item.id);
                  onClose();
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Estoque: relatório de pedido, pronto pra imprimir ----------
function PedidoReportModal({ clinicaId, tipo, itensFaltando, onClose, onConfirm }) {
  const [confirmado, setConfirmado] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const total = itensFaltando.length;
  const titulo = tipo === "limpeza_papelaria" ? `Pedido de limpeza/papelaria — ${clinicaInfo(clinicaId).nome}` : `Pedido de compras — ${clinicaInfo(clinicaId).nome}`;

  async function handleConfirmar() {
    setConfirming(true);
    await onConfirm();
    setConfirming(false);
    setConfirmado(true);
  }

  return (
    <div className="gec-modal-overlay" onClick={onClose}>
      <div className="gec-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="gec-print-hide" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div className="gec-display" style={{ fontSize: 18, fontWeight: 600 }}>{titulo}</div>
          <button className="gec-btn gec-btn-ghost" style={{ padding: 7 }} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="gec-print-area">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{titulo}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Gerado em {fmtDate(todayISO())} · {mesAnoLabel()} · {total} {total === 1 ? "item" : "itens"}
            </div>
          </div>
          {total === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--muted)" }}>Nenhum item abaixo da quantidade ideal agora.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--ink)" }}>
                  <th style={{ textAlign: "left", padding: "6px 4px" }}>Item</th>
                  <th style={{ textAlign: "left", padding: "6px 4px" }}>Categoria</th>
                  <th style={{ textAlign: "center", padding: "6px 4px" }}>Comprar</th>
                </tr>
              </thead>
              <tbody>
                {itensFaltando.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 4px" }}>{it.nome}</td>
                    <td style={{ padding: "6px 4px", color: "var(--muted)" }}>{it.categoria}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 700 }}>{fmtQty(quantoComprar(it))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="gec-print-hide" style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button type="button" className="gec-btn gec-btn-ghost" onClick={() => window.print()} disabled={total === 0}>
            <Printer size={14} /> Imprimir / salvar PDF
          </button>
          {!confirmado ? (
            <button
              type="button"
              className="gec-btn gec-btn-primary"
              style={{ flex: 1, justifyContent: "center" }}
              onClick={handleConfirmar}
              disabled={confirming || total === 0}
            >
              {confirming ? "Criando tarefa…" : "Confirmar pedido e criar tarefa"}
            </button>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--success)", fontWeight: 600 }}>
              Tarefa criada! Já pode fechar essa janela.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Estoque (tela principal) ----------
function EstoqueView({ itens, tipo, lockedClinicaId, canManage, onUpdateQty, onCreateItem, onUpdateItem, onDeleteItem, onSolicitarPedido }) {
  const [filterClinica, setFilterClinica] = useState("todas");
  const [expandedCategorias, setExpandedCategorias] = useState(() => new Set());
  const [showNovoItem, setShowNovoItem] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [showPedido, setShowPedido] = useState(false);

  const efetivoTipo = tipo || "clinico";
  const effectiveClinica = lockedClinicaId || (filterClinica === "todas" ? CLINICAS[0].id : filterClinica);
  const itensClinica = itens.filter((i) => i.clinicaId === effectiveClinica && (i.tipo || "clinico") === efetivoTipo);

  const categoriaMap = {};
  itensClinica.forEach((item) => {
    if (!categoriaMap[item.categoria]) categoriaMap[item.categoria] = [];
    categoriaMap[item.categoria].push(item);
  });
  const categorias = Object.keys(categoriaMap).sort((a, b) => a.localeCompare(b, "pt-BR"));
  categorias.forEach((c) => categoriaMap[c].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));

  const itensFaltando = itensClinica.filter((i) => quantoComprar(i) > 0).sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

  function toggleCategoria(categoria) {
    setExpandedCategorias((prev) => {
      const next = new Set(prev);
      if (next.has(categoria)) next.delete(categoria);
      else next.add(categoria);
      return next;
    });
  }

  function handleDelta(item, delta) {
    const novaQtd = Math.max(item.quantidadeAtual + delta, 0);
    onUpdateQty(item.id, novaQtd);
  }

  return (
    <div className="gec-fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        {!lockedClinicaId ? (
          <select className="gec-select" style={{ width: "auto" }} value={filterClinica === "todas" ? effectiveClinica : filterClinica} onChange={(e) => setFilterClinica(e.target.value)}>
            {CLINICAS.map((c) => (
              <option key={c.id} value={c.id}>{c.curto}</option>
            ))}
          </select>
        ) : (
          <div />
        )}
        {canManage && (
          <button className="gec-btn gec-btn-ghost" onClick={() => setShowNovoItem(true)}>
            <Plus size={15} /> Adicionar item
          </button>
        )}
      </div>

      {categorias.length === 0 ? (
        <EmptyState
          icon={efetivoTipo === "limpeza_papelaria" ? Boxes : Package}
          title="Nenhum item cadastrado"
          subtitle={efetivoTipo === "limpeza_papelaria" ? "Adicione o primeiro item de limpeza/papelaria dessa clínica." : "Adicione o primeiro item do estoque dessa clínica."}
        />
      ) : (
        categorias.map((categoria) => (
          <EstoqueCategoriaSection
            key={categoria}
            categoria={categoria}
            itens={categoriaMap[categoria]}
            canManage={canManage}
            expanded={expandedCategorias.has(categoria)}
            onToggle={() => toggleCategoria(categoria)}
            onDelta={handleDelta}
            onEdit={setEditItem}
          />
        ))
      )}

      {canManage && categorias.length > 0 && (
        <button className="gec-btn gec-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => setShowPedido(true)}>
          <ShoppingCart size={15} /> Solicitar pedido {itensFaltando.length > 0 && `(${itensFaltando.length})`}
        </button>
      )}

      {showNovoItem && (
        <EstoqueItemModal
          clinicaId={effectiveClinica}
          tipo={efetivoTipo}
          categoriasExistentes={categorias}
          onClose={() => setShowNovoItem(false)}
          onSave={onCreateItem}
          onDelete={onDeleteItem}
        />
      )}
      {editItem && (
        <EstoqueItemModal
          item={editItem}
          clinicaId={effectiveClinica}
          tipo={efetivoTipo}
          categoriasExistentes={categorias}
          onClose={() => setEditItem(null)}
          onSave={(patch) => onUpdateItem(editItem.id, patch)}
          onDelete={onDeleteItem}
        />
      )}
      {showPedido && (
        <PedidoReportModal
          clinicaId={effectiveClinica}
          tipo={efetivoTipo}
          itensFaltando={itensFaltando}
          onClose={() => setShowPedido(false)}
          onConfirm={() => onSolicitarPedido(effectiveClinica, itensFaltando, efetivoTipo)}
        />
      )}
    </div>
  );
}

// ---------- App shell ----------
export default function PulsoApp() {
  useMidnightTick();
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [team, setTeam] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [comments, setComments] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [activity, setActivity] = useState([]);
  const [leads, setLeads] = useState([]);
  const [estoque, setEstoque] = useState([]);
  const [indicacoes, setIndicacoes] = useState([]);
  const [cobrancas, setCobrancas] = useState([]);
  const [view, setView] = useState("painel");
  const [ownerClinicView, setOwnerClinicView] = useState("todas");
  const [detailTarget, setDetailTarget] = useState(null);
  const [detailLead, setDetailLead] = useState(null);
  const [error, setError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) {
      setError("Não foi possível carregar seu perfil.");
      return null;
    }
    return mapProfile(data);
  }, []);

  const fetchTeam = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("nome");
    if (!error && data) setTeam(data.map(mapProfile));
  }, []);

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("prazo", { ascending: true, nullsFirst: false });
    if (!error && data) setTasks(data.map(mapTask));
  }, []);

  const fetchAttachments = useCallback(async () => {
    const { data, error } = await supabase.from("task_attachments").select("*").order("created_at");
    if (error || !data) return;
    const mapped = data.map(mapAttachment);
    const paths = mapped.map((a) => a.path);
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from("task-files").createSignedUrls(paths, 3600);
      if (signed) {
        signed.forEach((s, i) => {
          if (s?.signedUrl) mapped[i].url = s.signedUrl;
        });
      }
    }
    setAttachments(mapped);
  }, []);

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase.from("task_comments").select("*").order("created_at");
    if (!error && data) setComments(data.map(mapComment));
  }, []);

  const fetchChecklist = useCallback(async () => {
    const { data, error } = await supabase.from("task_checklist_items").select("*").order("ordem");
    if (!error && data) setChecklist(data.map(mapChecklistItem));
  }, []);

  const fetchActivity = useCallback(async () => {
    const { data, error } = await supabase.from("task_activity").select("*").order("created_at");
    if (!error && data) setActivity(data.map(mapActivity));
  }, []);

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase.from("leads").select("*").order("criado_em", { ascending: false });
    if (!error && data) setLeads(data.map(mapLead));
  }, []);

  const fetchEstoque = useCallback(async () => {
    const { data, error } = await supabase.from("estoque_itens").select("*").order("categoria").order("nome");
    if (!error && data) setEstoque(data.map(mapEstoqueItem));
  }, []);

  const fetchIndicacoes = useCallback(async () => {
    const { data, error } = await supabase.from("indicacoes").select("*").order("criado_em", { ascending: false });
    if (!error && data) setIndicacoes(data.map(mapIndicacao));
  }, []);

  const fetchCobrancas = useCallback(async () => {
    const { data, error } = await supabase.from("cobrancas").select("*").order("dia_vencimento");
    if (!error && data) setCobrancas(data.map(mapCobranca));
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setTeam([]);
      setTasks([]);
      setAttachments([]);
      setComments([]);
      setChecklist([]);
      setActivity([]);
      setLeads([]);
      setEstoque([]);
      setIndicacoes([]);
      setCobrancas([]);
      return;
    }
    (async () => {
      setProfileLoading(true);
      const p = await fetchProfile(session.user.id);
      setProfile(p);
      if (p) await Promise.all([fetchTeam(), fetchTasks(), fetchAttachments(), fetchComments(), fetchChecklist(), fetchActivity(), fetchLeads(), fetchEstoque(), fetchIndicacoes(), fetchCobrancas()]);
      setProfileLoading(false);
    })();
  }, [session, fetchProfile, fetchTeam, fetchTasks, fetchAttachments, fetchComments, fetchChecklist, fetchActivity, fetchLeads, fetchEstoque, fetchIndicacoes, fetchCobrancas]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel("pulso-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => fetchTasks())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => fetchTeam())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_attachments" }, () => fetchAttachments())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, () => fetchComments())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist_items" }, () => fetchChecklist())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_activity" }, () => fetchActivity())
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => fetchLeads())
      .on("postgres_changes", { event: "*", schema: "public", table: "estoque_itens" }, () => fetchEstoque())
      .on("postgres_changes", { event: "*", schema: "public", table: "indicacoes" }, () => fetchIndicacoes())
      .on("postgres_changes", { event: "*", schema: "public", table: "cobrancas" }, () => fetchCobrancas())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, fetchTasks, fetchTeam, fetchAttachments, fetchComments, fetchChecklist, fetchActivity, fetchLeads, fetchEstoque, fetchIndicacoes, fetchCobrancas]);

  const uploadAttachment = useCallback(
    async (task, file) => {
      const path = `${task.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("task-files").upload(path, file);
      if (upErr) {
        setError("Não foi possível enviar o arquivo: " + upErr.message);
        throw upErr;
      }
      const { error: insErr } = await supabase.from("task_attachments").insert({
        task_id: task.id,
        file_path: path,
        file_name: file.name,
        uploaded_by: profile?.id,
      });
      if (insErr) setError("Não foi possível registrar o anexo: " + insErr.message);
      else fetchAttachments();
    },
    [profile, fetchAttachments]
  );

  const deleteAttachment = useCallback(
    async (attachment) => {
      await supabase.storage.from("task-files").remove([attachment.path]);
      const { error } = await supabase.from("task_attachments").delete().eq("id", attachment.id);
      if (error) setError("Não foi possível remover o anexo: " + error.message);
      else fetchAttachments();
    },
    [fetchAttachments]
  );

  const logActivity = useCallback(
    async (taskId, tipo, detalhe) => {
      await supabase.from("task_activity").insert({ task_id: taskId, autor_id: profile?.id, tipo, detalhe: detalhe || null });
    },
    [profile]
  );

  const handleCreateTask = useCallback(
    async (task, file) => {
      // Se a tarefa é recorrente, guarda quem é o "dono" da recorrência dentro
      // da própria regra — assim, se essa ocorrência for delegada pra outra
      // pessoa depois, as próximas ocorrências continuam voltando pra ela.
      const recorrencia = task.recorrencia ? { ...task.recorrencia, responsavelBase: task.responsavelId } : null;
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          titulo: task.titulo,
          descricao: task.descricao,
          clinica_id: task.clinicaId,
          responsavel_id: task.responsavelId,
          status: "pendente",
          prazo: task.prazo || null,
          criado_por: profile?.id,
          recorrencia,
        })
        .select()
        .single();
      if (error) {
        setError("Não foi possível criar a tarefa: " + error.message);
        return;
      }
      if (file && data) {
        await uploadAttachment(mapTask(data), file);
      }
      if (data) await logActivity(data.id, "criada");
      fetchTasks();
    },
    [profile, fetchTasks, uploadAttachment, logActivity]
  );

  const handleUpdateStatus = useCallback(
    async (id, status, file) => {
      const original = tasks.find((t) => t.id === id);
      const { error } = await supabase
        .from("tasks")
        .update({ status, concluido_em: status === "concluida" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) {
        setError("Não foi possível atualizar a tarefa: " + error.message);
        return;
      }
      if (file) {
        await uploadAttachment({ id }, file);
      }
      if (original && original.status !== status) {
        logActivity(id, "status_alterado", `${STATUS[original.status]?.label || original.status} → ${STATUS[status]?.label || status}`);
      }
      // Tarefa recorrente concluída: gera a próxima ocorrência automaticamente,
      // sempre para quem a recorrência pertence (não para quem ficou com essa
      // ocorrência caso ela tenha sido delegada).
      if (status === "concluida" && original?.recorrencia) {
        const nextPrazo = computeNextPrazo(original.prazo, original.recorrencia);
        if (nextPrazo) {
          const { error: spawnError } = await supabase.from("tasks").insert({
            titulo: original.titulo,
            descricao: original.descricao,
            clinica_id: original.clinicaId,
            responsavel_id: original.recorrencia.responsavelBase || original.responsavelId,
            status: "pendente",
            prazo: nextPrazo,
            criado_por: profile?.id,
            recorrencia: original.recorrencia,
          });
          if (spawnError) setError("Não foi possível criar a próxima ocorrência: " + spawnError.message);
        }
      }
      fetchTasks();
    },
    [fetchTasks, uploadAttachment, tasks, profile, logActivity]
  );

  const handleStopRecurrence = useCallback(
    async (id) => {
      const { error } = await supabase.from("tasks").update({ recorrencia: null }).eq("id", id);
      if (error) setError("Não foi possível parar a recorrência: " + error.message);
      else {
        logActivity(id, "recorrencia_parada");
        fetchTasks();
      }
    },
    [fetchTasks, logActivity]
  );

  const handleUpdatePriority = useCallback(
    async (id, prioridade) => {
      const { error } = await supabase.from("tasks").update({ prioridade }).eq("id", id);
      if (error) setError("Não foi possível atualizar a prioridade: " + error.message);
      else {
        logActivity(id, "prioridade_alterada", PRIORIDADES[prioridade]?.label || prioridade);
        fetchTasks();
      }
    },
    [fetchTasks, logActivity]
  );

  const handleUpdateCategoria = useCallback(
    async (id, categoria) => {
      const { error } = await supabase.from("tasks").update({ categoria }).eq("id", id);
      if (error) setError("Não foi possível atualizar a categoria: " + error.message);
      else {
        logActivity(id, "categoria_alterada", categoria ? categoriaLabel(categoria) : "sem categoria");
        fetchTasks();
      }
    },
    [fetchTasks, logActivity]
  );

  const handleDelegate = useCallback(
    async (id, novoResponsavelId) => {
      const original = tasks.find((t) => t.id === id);
      const { error } = await supabase.from("tasks").update({ responsavel_id: novoResponsavelId }).eq("id", id);
      if (error) {
        setError("Não foi possível delegar a tarefa: " + error.message);
        return;
      }
      const deQuem = original ? memberName(original.responsavelId, team) : "—";
      const paraQuem = memberName(novoResponsavelId, team);
      logActivity(id, "delegada", `${deQuem} → ${paraQuem}`);
      fetchTasks();
    },
    [fetchTasks, logActivity, tasks, team]
  );

  const handleAddComment = useCallback(
    async (taskId, texto) => {
      const { error } = await supabase.from("task_comments").insert({ task_id: taskId, autor_id: profile?.id, texto });
      if (error) setError("Não foi possível adicionar o comentário: " + error.message);
      else fetchComments();
    },
    [profile, fetchComments]
  );

  const handleDeleteComment = useCallback(
    async (commentId) => {
      const { error } = await supabase.from("task_comments").delete().eq("id", commentId);
      if (error) setError("Não foi possível remover o comentário: " + error.message);
      else fetchComments();
    },
    [fetchComments]
  );

  const handleAddChecklistItem = useCallback(
    async (taskId, texto) => {
      const ordem = checklist.filter((c) => c.taskId === taskId).length;
      const { error } = await supabase.from("task_checklist_items").insert({ task_id: taskId, texto, ordem });
      if (error) setError("Não foi possível adicionar o item: " + error.message);
      else fetchChecklist();
    },
    [checklist, fetchChecklist]
  );

  const handleToggleChecklistItem = useCallback(
    async (itemId, concluido) => {
      const { error } = await supabase.from("task_checklist_items").update({ concluido }).eq("id", itemId);
      if (error) setError("Não foi possível atualizar o item: " + error.message);
      else fetchChecklist();
    },
    [fetchChecklist]
  );

  const handleDeleteChecklistItem = useCallback(
    async (itemId) => {
      const { error } = await supabase.from("task_checklist_items").delete().eq("id", itemId);
      if (error) setError("Não foi possível remover o item: " + error.message);
      else fetchChecklist();
    },
    [fetchChecklist]
  );

  // Só inclui uma coluna no objeto se a chave correspondente realmente veio no
  // patch — assim um patch parcial (ex: só "etapa" mudou) nunca zera as demais
  // colunas no banco, mesmo que o patch já não traga mais todos os campos.
  function leadPatchToRow(patch) {
    const row = {};
    if ("clinicaId" in patch) row.clinica_id = patch.clinicaId;
    if ("nomePaciente" in patch) row.nome_paciente = patch.nomePaciente;
    if ("whatsapp" in patch) row.whatsapp = patch.whatsapp || null;
    if ("responsavelComercial" in patch) row.responsavel_comercial = patch.responsavelComercial || null;
    if ("procedimento" in patch) row.procedimento = patch.procedimento || null;
    if ("etapa" in patch) row.etapa = patch.etapa;
    if ("dataAvaliacao" in patch) row.data_avaliacao = patch.dataAvaliacao || null;
    if ("proximoContato" in patch) row.proximo_contato = patch.proximoContato || null;
    if ("codigoPaciente" in patch) row.codigo_paciente = patch.codigoPaciente || null;
    if ("historia" in patch) row.historia = patch.historia || null;
    if ("evolucao" in patch) row.evolucao = patch.evolucao || null;
    if ("observacoes" in patch) row.observacoes = patch.observacoes || null;
    if ("origem" in patch) row.origem = patch.origem || null;
    if ("indicadoPor" in patch) row.indicado_por = patch.indicadoPor || null;
    if ("valorOrcado" in patch) row.valor_orcado = patch.valorOrcado;
    if ("valorPago" in patch) row.valor_pago = patch.valorPago;
    return row;
  }

  // Mensagem amigável quando a trava de código de paciente duplicado (banco)
  // barra o salvamento, em vez de mostrar o erro técnico cru do Postgres.
  function friendlyLeadError(error, fallback) {
    if (error.code === "23505") return "Já existe uma oportunidade com esse código de paciente nessa clínica.";
    return fallback + error.message;
  }

  const handleCreateLead = useCallback(
    async (patch) => {
      const { error } = await supabase.from("leads").insert({ ...leadPatchToRow(patch), criado_por: profile?.id });
      if (error) {
        const msg = friendlyLeadError(error, "Não foi possível criar a oportunidade: ");
        setError(msg);
        throw new Error(msg);
      }
      fetchLeads();
    },
    [profile, fetchLeads]
  );

  const handleUpdateLead = useCallback(
    async (id, patch) => {
      const row = leadPatchToRow(patch);
      if (Object.keys(row).length === 0) return; // nada mudou, não precisa chamar o banco
      const { error } = await supabase.from("leads").update(row).eq("id", id);
      if (error) {
        const msg = friendlyLeadError(error, "Não foi possível salvar a oportunidade: ");
        setError(msg);
        throw new Error(msg);
      }
      fetchLeads();
    },
    [fetchLeads]
  );

  const handleChangeLeadStage = useCallback(
    async (id, etapa) => {
      const patch = { etapa };
      // Fechado/perdido: não vamos mais entrar em contato, limpa o follow-up pendente.
      if (etapa === "fechado" || etapa === "perdido") patch.proximo_contato = null;
      // Avaliação agendada: o follow-up é sempre a data da avaliação (nesse dia a equipe
      // tem que confirmar se o paciente veio e tentar reagendar caso tenha faltado).
      if (etapa === "avaliacao_agendada") {
        const lead = leads.find((l) => l.id === id);
        patch.proximo_contato = lead?.dataAvaliacao || null;
      }
      const { error } = await supabase.from("leads").update(patch).eq("id", id);
      if (error) setError("Não foi possível mover a oportunidade: " + error.message);
      else fetchLeads();
    },
    [leads, fetchLeads]
  );

  const handleDeleteLead = useCallback(
    async (id) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) setError("Não foi possível excluir a oportunidade: " + error.message);
      else fetchLeads();
    },
    [fetchLeads]
  );

  const handleImportLeads = useCallback(
    async (rows) => {
      const vistos = new Set(
        leads.filter((l) => l.clinicaId === "sorridents" && l.codigoPaciente).map((l) => String(l.codigoPaciente).trim())
      );
      const novos = [];
      for (const r of rows) {
        const codigo = r.codigoPaciente && String(r.codigoPaciente).trim();
        if (!codigo || vistos.has(codigo)) continue;
        vistos.add(codigo);
        novos.push(r);
      }
      if (novos.length === 0) return { criados: 0, ignorados: rows.length };
      const payload = novos.map((r) => ({
        ...leadPatchToRow({
          clinicaId: "sorridents",
          nomePaciente: r.nomePaciente,
          whatsapp: r.whatsapp || null,
          etapa: "avaliacao_agendada",
          dataAvaliacao: r.dataAvaliacao || null,
          // Nessa etapa o follow-up é sempre a própria data da avaliação.
          proximoContato: r.dataAvaliacao || null,
          codigoPaciente: r.codigoPaciente,
        }),
        criado_por: profile?.id,
      }));
      const { error } = await supabase.from("leads").insert(payload);
      if (error) {
        setError("Não foi possível importar a planilha: " + error.message);
        return null;
      }
      await fetchLeads();
      return { criados: novos.length, ignorados: rows.length - novos.length };
    },
    [leads, profile, fetchLeads]
  );

  const handleCreateIndicacao = useCallback(
    async (patch) => {
      const { error } = await supabase.from("indicacoes").insert({
        tecnico_id: profile?.id,
        nome_paciente: patch.nomePaciente,
        procedimento: patch.procedimento,
        observacao: patch.observacao || null,
      });
      if (error) setError("Não foi possível enviar a indicação: " + error.message);
      else {
        fetchIndicacoes();
        fetchLeads();
        fetchTasks();
      }
    },
    [profile, fetchIndicacoes, fetchLeads, fetchTasks]
  );

  // Só inclui uma coluna se a chave correspondente veio no patch — assim um
  // patch parcial (só o que mudou na tela) nunca zera as demais colunas.
  function cobrancaPatchToRow(patch) {
    const row = {};
    if ("nomeCliente" in patch) row.nome_cliente = patch.nomeCliente;
    if ("whatsapp" in patch) row.whatsapp = patch.whatsapp || null;
    if ("formaPagamento" in patch) row.forma_pagamento = patch.formaPagamento;
    if ("diaVencimento" in patch) row.dia_vencimento = patch.diaVencimento;
    if ("valorParcela" in patch) row.valor_parcela = patch.valorParcela;
    if ("numeroParcelas" in patch) row.numero_parcelas = patch.numeroParcelas;
    if ("parcelasPagas" in patch) row.parcelas_pagas = patch.parcelasPagas;
    if ("observacoes" in patch) row.observacoes = patch.observacoes || null;
    if ("ativo" in patch) row.ativo = patch.ativo;
    return row;
  }

  const handleCreateCobranca = useCallback(
    async (patch) => {
      const { error } = await supabase
        .from("cobrancas")
        .insert({ ...cobrancaPatchToRow(patch), clinica_id: "gio", criado_por: profile?.id });
      if (error) setError("Não foi possível cadastrar a cobrança: " + error.message);
      else fetchCobrancas();
    },
    [profile, fetchCobrancas]
  );

  const handleUpdateCobranca = useCallback(
    async (id, patch) => {
      const row = cobrancaPatchToRow(patch);
      if (Object.keys(row).length === 0) return; // nada mudou, não precisa chamar o banco
      const { error } = await supabase.from("cobrancas").update(row).eq("id", id);
      if (error) setError("Não foi possível salvar a cobrança: " + error.message);
      else fetchCobrancas();
    },
    [fetchCobrancas]
  );

  const handleDeleteCobranca = useCallback(
    async (id) => {
      const { error } = await supabase.from("cobrancas").delete().eq("id", id);
      if (error) setError("Não foi possível excluir a cobrança: " + error.message);
      else fetchCobrancas();
    },
    [fetchCobrancas]
  );

  // Cria a tarefa de cobrança (boleto/recorrente) do ciclo atual e avança o
  // contador de parcelas — desativa sozinha a cobrança quando a última
  // parcela é alcançada, pra parar de gerar tarefa novas depois disso.
  const handleGenerateCobrancaTask = useCallback(
    async (cobranca, info, responsavelId) => {
      const { error: insErr } = await supabase.from("tasks").insert({
        titulo: info.titulo,
        clinica_id: "gio",
        responsavel_id: responsavelId,
        prazo: info.prazo,
        criado_por: profile?.id,
        cobranca_id: cobranca.id,
      });
      // Se der erro (ex: outra sessão da equipe já criou essa mesma tarefa no
      // mesmo instante — a trava do banco impede duplicar), não avança o
      // contador de parcelas, pra não contar a mesma parcela duas vezes.
      if (insErr) return;
      const novasParcelasPagas = cobranca.parcelasPagas + 1;
      await supabase
        .from("cobrancas")
        .update({ parcelas_pagas: novasParcelasPagas, ativo: novasParcelasPagas < cobranca.numeroParcelas })
        .eq("id", cobranca.id);
      fetchTasks();
      fetchCobrancas();
    },
    [profile, fetchTasks, fetchCobrancas]
  );

  // Toda vez que a lista de cobranças/tarefas muda (inclusive ao abrir o
  // app), confere se alguma cobrança ativa da GIO precisa de uma tarefa hoje
  // (boleto vencendo ou pagamento recorrente pra conferir) e cria — sempre
  // pra gerente da GIO (ou pro dono, se não tiver gerente cadastrada lá).
  useEffect(() => {
    if (!profile || cobrancas.length === 0) return;
    const hoje = todayISO();
    const responsavelId =
      team.find((m) => m.role === "gerente" && m.clinicaId === "gio")?.id ||
      team.find((m) => m.role === "owner")?.id;
    if (!responsavelId) return;
    cobrancas
      .filter((c) => c.ativo)
      .forEach((c) => {
        const info = computeCobrancaTask(c, hoje);
        if (!info) return;
        const jaExiste = tasks.some((t) => t.cobrancaId === c.id && t.prazo === info.prazo);
        if (jaExiste) return;
        handleGenerateCobrancaTask(c, info, responsavelId);
      });
  }, [cobrancas, tasks, team, profile, handleGenerateCobrancaTask]);

  const handleGenerateFollowUpTask = useCallback(
    async (lead, prazo, titulo, responsavelId) => {
      const { error: insErr } = await supabase.from("tasks").insert({
        titulo,
        clinica_id: lead.clinicaId,
        responsavel_id: responsavelId,
        status: "pendente",
        prazo,
        criado_por: profile?.id,
        categoria: "atendimento",
        lead_id: lead.id,
      });
      // Se der erro (ex: outra sessão da equipe já criou essa mesma tarefa no
      // mesmo instante — a trava do banco impede duplicar), não tem o que
      // fazer além de deixar quieto; a próxima checagem não tenta de novo
      // porque a tarefa já existe.
      if (insErr) return;
      fetchTasks();
    },
    [profile, fetchTasks]
  );

  // Toda vez que a lista de leads/tarefas muda (inclusive ao abrir o app),
  // confere se algum lead com responsável comercial definido está com
  // follow-up (ou avaliação, na etapa "avaliação agendada" — ver
  // leadContatoRelevante) vencendo hoje ou atrasado, e cria a tarefa
  // correspondente pro responsável — mesmo mecanismo das Cobranças.
  useEffect(() => {
    if (!profile || leads.length === 0) return;
    leads.forEach((l) => {
      if (!l.responsavelComercial) return;
      const atrasado = isFollowUpAtrasado(l);
      const venceHoje = !atrasado && isFollowUpHoje(l);
      if (!atrasado && !venceHoje) return;
      const prazo = leadContatoRelevante(l);
      const jaExiste = tasks.some((t) => t.leadId === l.id && t.prazo === prazo);
      if (jaExiste) return;
      const titulo = `${l.etapa === "avaliacao_agendada" ? "Confirmar avaliação" : "Follow-up"} — ${l.nomePaciente}`;
      handleGenerateFollowUpTask(l, prazo, titulo, l.responsavelComercial);
    });
  }, [leads, tasks, profile, handleGenerateFollowUpTask]);
  function estoquePatchToRow(patch) {
    const row = {};
    if ("clinicaId" in patch) row.clinica_id = patch.clinicaId;
    if ("tipo" in patch) row.tipo = patch.tipo || "clinico";
    if ("categoria" in patch) row.categoria = patch.categoria || null;
    if ("nome" in patch) row.nome = patch.nome;
    if ("quantidadeIdeal" in patch) row.quantidade_ideal = patch.quantidadeIdeal;
    if ("quantidadeAtual" in patch) row.quantidade_atual = patch.quantidadeAtual;
    return row;
  }

  const handleCreateEstoqueItem = useCallback(
    async (patch) => {
      const { error } = await supabase.from("estoque_itens").insert({ ...estoquePatchToRow(patch), criado_por: profile?.id });
      if (error) setError("Não foi possível adicionar o item: " + error.message);
      else fetchEstoque();
    },
    [profile, fetchEstoque]
  );

  const handleUpdateEstoqueItem = useCallback(
    async (id, patch) => {
      const row = estoquePatchToRow(patch);
      if (Object.keys(row).length === 0) return; // nada mudou, não precisa chamar o banco
      const { error } = await supabase.from("estoque_itens").update(row).eq("id", id);
      if (error) setError("Não foi possível salvar o item: " + error.message);
      else fetchEstoque();
    },
    [fetchEstoque]
  );

  const handleUpdateEstoqueQty = useCallback(
    async (id, quantidadeAtual) => {
      const { error } = await supabase.from("estoque_itens").update({ quantidade_atual: quantidadeAtual }).eq("id", id);
      if (error) setError("Não foi possível atualizar a quantidade: " + error.message);
      else fetchEstoque();
    },
    [fetchEstoque]
  );

  const handleDeleteEstoqueItem = useCallback(
    async (id) => {
      const { error } = await supabase.from("estoque_itens").delete().eq("id", id);
      if (error) setError("Não foi possível excluir o item: " + error.message);
      else fetchEstoque();
    },
    [fetchEstoque]
  );

  const handleSolicitarPedido = useCallback(
    async (clinicaId, itensFaltando, tipo) => {
      const owner = team.find((m) => m.role === "owner");
      if (!owner) {
        setError("Não encontrei o gestor pra atribuir a tarefa.");
        return;
      }
      const prefixo = tipo === "limpeza_papelaria" ? "Pedido de limpeza/papelaria" : "Pedido de compras";
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          titulo: `${prefixo} – ${clinicaInfo(clinicaId).curto} – ${mesAnoLabel()}`,
          descricao: "",
          clinica_id: clinicaId,
          responsavel_id: owner.id,
          status: "pendente",
          prazo: todayISO(),
          criado_por: profile?.id,
          categoria: "estoque",
        })
        .select()
        .single();
      if (error) {
        setError("Não foi possível criar a tarefa de compras: " + error.message);
        return;
      }
      if (data && itensFaltando.length > 0) {
        const itemsPayload = itensFaltando.map((it, idx) => ({
          task_id: data.id,
          texto: `${it.nome} — comprar ${fmtQty(quantoComprar(it))}`,
          ordem: idx,
        }));
        await supabase.from("task_checklist_items").insert(itemsPayload);
      }
      if (data) await logActivity(data.id, "criada");
      fetchTasks();
      fetchChecklist();
    },
    [team, profile, fetchTasks, fetchChecklist, logActivity]
  );

  const handleDeleteTask = useCallback(
    async (id) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) setError("Não foi possível excluir a tarefa: " + error.message);
      else fetchTasks();
    },
    [fetchTasks]
  );

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const attachmentsByTask = useMemo(() => {
    const map = {};
    attachments.forEach((a) => {
      if (!map[a.taskId]) map[a.taskId] = [];
      map[a.taskId].push(a);
    });
    return map;
  }, [attachments]);

  const commentsByTask = useMemo(() => {
    const map = {};
    comments.forEach((c) => {
      if (!map[c.taskId]) map[c.taskId] = [];
      map[c.taskId].push(c);
    });
    return map;
  }, [comments]);

  const checklistByTask = useMemo(() => {
    const map = {};
    checklist.forEach((c) => {
      if (!map[c.taskId]) map[c.taskId] = [];
      map[c.taskId].push(c);
    });
    return map;
  }, [checklist]);

  const activityByTask = useMemo(() => {
    const map = {};
    activity.forEach((a) => {
      if (!map[a.taskId]) map[a.taskId] = [];
      map[a.taskId].push(a);
    });
    return map;
  }, [activity]);

  if (session === undefined || (session && profileLoading && !profile)) {
    return (
      <div className="gec-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div style={{ color: "var(--muted)", fontSize: 13.5 }}>Carregando…</div>
      </div>
    );
  }

  if (!session || !profile) {
    return <LoginScreen />;
  }

  const user = profile;
  const isOwner = user.role === "owner";

  // Gerente/base/técnico sem clínica vinculada não bate em nenhuma regra de
  // acesso (todas são "por clínica") — em vez de deixar a pessoa navegar por
  // um app inteiro vazio sem entender por quê, avisa e para por aqui.
  if (!isOwner && !user.clinicaId) {
    // Usa supabase.auth.signOut() direto (em vez de handleLogout, que só é
    // declarado mais abaixo no corpo da função) pra não depender de uma
    // const que ainda não foi inicializada nesse ponto da renderização.
    return <NoClinicaScreen onLogout={() => supabase.auth.signOut()} />;
  }

  const isGerente = user.role === "gerente";
  const isBase = user.role === "base";
  const isTecnico = user.role === "tecnico";
  const canManage = isOwner || isGerente;

  const staffTeam = team.filter((m) => m.role !== "owner");
  const ownerAndStaff = team;

  const effectiveClinica = isOwner ? (ownerClinicView === "todas" ? null : ownerClinicView) : user.clinicaId;

  const dashboardTeam = isOwner
    ? effectiveClinica
      ? staffTeam.filter((m) => m.clinicaId === effectiveClinica)
      : staffTeam
    : staffTeam.filter((m) => m.clinicaId === user.clinicaId);

  const namesTeam = isOwner
    ? ownerAndStaff
    : ownerAndStaff.filter((m) => m.clinicaId === user.clinicaId || m.role === "owner");

  const dashboardTasks = isOwner ? (effectiveClinica ? tasks.filter((t) => t.clinicaId === effectiveClinica) : tasks) : tasks.filter((t) => t.clinicaId === user.clinicaId);

  const tasksViewTasks = isOwner ? (effectiveClinica ? tasks.filter((t) => t.clinicaId === effectiveClinica) : tasks) : tasks.filter((t) => t.clinicaId === user.clinicaId);

  const assignableOptions = getAssignableOptions(user, team).map((m) => ({ id: m.id, nome: m.nome }));

  // Aba de Limpeza e Papelaria: só existe pra Sorridents (gestor sempre vê,
  // gerente/base só se forem da Sorridents).
  const limpezaTab = { id: "limpeza", label: "Limpeza e Papelaria", icon: Boxes };
  const vePraSorridents = user.clinicaId === "sorridents";

  // Aba de Cobranças (boleto/recorrente): só existe pra GIO — gestor sempre
  // vê, gerente/base só se forem da GIO. Técnica nunca vê (fica de fora por
  // omissão, igual às outras abas administrativas).
  const cobrancasTab = { id: "cobrancas", label: "Cobranças", icon: CreditCard };
  const vePraGio = user.clinicaId === "gio";

  const tabs = isOwner
    ? [
        { id: "painel", label: "Painel", icon: LayoutDashboard },
        { id: "tarefas", label: "Tarefas", icon: ClipboardList },
        { id: "minhas", label: "Minhas tarefas", icon: UserCheck },
        { id: "comercial", label: "Comercial", icon: Briefcase },
        { id: "estoque", label: "Estoque", icon: Package },
        limpezaTab,
        cobrancasTab,
        { id: "equipe", label: "Equipe", icon: Users },
      ]
    : isGerente
    ? [
        { id: "painel", label: "Painel", icon: LayoutDashboard },
        { id: "tarefas", label: "Tarefas", icon: ClipboardList },
        { id: "minhas", label: "Minhas tarefas", icon: UserCheck },
        { id: "comercial", label: "Comercial", icon: Briefcase },
        { id: "estoque", label: "Estoque", icon: Package },
        ...(vePraSorridents ? [limpezaTab] : []),
        ...(vePraGio ? [cobrancasTab] : []),
      ]
    : isTecnico
    ? [{ id: "indicacoes", label: "Indicações", icon: Stethoscope }]
    : [
        { id: "minhas", label: "Minhas tarefas", icon: ClipboardList },
        { id: "comercial", label: "Comercial", icon: Briefcase },
        { id: "estoque", label: "Estoque", icon: Package },
        ...(vePraSorridents ? [limpezaTab] : []),
        ...(vePraGio ? [cobrancasTab] : []),
      ];

  // Se a aba guardada em `view` não existe mais pro papel atual (ex: base
  // trocou de aba antes, ou o papel mudou), cai pra primeira aba disponível.
  const activeView = tabs.some((t) => t.id === view) ? view : tabs[0].id;

  return (
    <div className="gec-root" style={{ minHeight: "100vh" }}>
      <GlobalStyle />
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ClipboardList size={15} color="#fff" />
            </div>
            <div className="gec-display" style={{ fontSize: 16, fontWeight: 600 }}>Pulso</div>
          </div>
          <div className="gec-scrollbar" style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {tabs.map((t) => (
              <div key={t.id} role="button" tabIndex={0} className={`gec-nav-tab ${activeView === t.id ? "active" : ""}`} onClick={() => setView(t.id)} onKeyDown={(e) => e.key === "Enter" && setView(t.id)}>
                <t.icon size={14} /> {t.label}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar nome={user.nome} size={28} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{user.nome}</div>
              {!isOwner && (
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.2 }}>
                  {roleLabel(user.role, user.clinicaId)} · {clinicaInfo(user.clinicaId).curto}
                </div>
              )}
            </div>
            <button className="gec-btn gec-btn-ghost" style={{ padding: 8 }} onClick={handleLogout} aria-label="Sair">
              <LogOut size={14} />
            </button>
          </div>
        </div>
        {isOwner && (
          <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px 12px", display: "flex", gap: 8 }}>
            <button className={`gec-clinic-tab ${ownerClinicView === "todas" ? "active" : ""}`} onClick={() => setOwnerClinicView("todas")}>
              Todas as clínicas
            </button>
            {CLINICAS.map((c) => (
              <button key={c.id} className={`gec-clinic-tab ${ownerClinicView === c.id ? "active" : ""}`} onClick={() => setOwnerClinicView(c.id)}>
                {c.curto}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 60px" }}>
        {error && (
          <div style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{error}</span>
            <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontWeight: 700 }} aria-label="Fechar aviso">×</button>
          </div>
        )}

        {isOwner && activeView === "painel" && <Dashboard team={dashboardTeam} tasks={dashboardTasks} onOpenTask={setDetailTarget} />}
        {isGerente && activeView === "painel" && <Dashboard team={dashboardTeam} tasks={dashboardTasks} onOpenTask={setDetailTarget} />}

        {isOwner && activeView === "tarefas" && (
          <TasksView
            team={namesTeam}
            tasks={tasksViewTasks}
            assignableOptions={assignableOptions}
            lockedClinicaId={effectiveClinica}
            hideClinicaFilter={!!effectiveClinica}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            onCreate={handleCreateTask}
            onUpdateStatus={handleUpdateStatus}
            onDelete={handleDeleteTask}
            onOpenDetail={setDetailTarget}
          />
        )}
        {isGerente && activeView === "tarefas" && (
          <TasksView
            team={namesTeam}
            tasks={tasksViewTasks}
            assignableOptions={assignableOptions}
            lockedClinicaId={user.clinicaId}
            hideClinicaFilter
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            onCreate={handleCreateTask}
            onUpdateStatus={handleUpdateStatus}
            onDelete={handleDeleteTask}
            onOpenDetail={setDetailTarget}
          />
        )}

        {isOwner && activeView === "minhas" && (
          <MyTasksView
            user={user}
            tasks={tasks}
            leads={leads}
            assignableOptions={assignableOptions}
            lockedClinicaId={null}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            onUpdateStatus={handleUpdateStatus}
            onCreate={handleCreateTask}
            onOpenDetail={setDetailTarget}
            onOpenLead={setDetailLead}
          />
        )}

        {isOwner && activeView === "equipe" && <TeamView team={staffTeam} />}

        {isGerente && activeView === "minhas" && (
          <MyTasksView
            user={user}
            tasks={tasks}
            leads={leads}
            assignableOptions={assignableOptions}
            lockedClinicaId={user.clinicaId}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            onUpdateStatus={handleUpdateStatus}
            onCreate={handleCreateTask}
            onOpenDetail={setDetailTarget}
            onOpenLead={setDetailLead}
          />
        )}

        {isBase && activeView === "minhas" && (
          <MyTasksView
            user={user}
            tasks={tasks}
            leads={leads}
            assignableOptions={assignableOptions}
            lockedClinicaId={user.clinicaId}
            attachmentsByTask={attachmentsByTask}
            commentsByTask={commentsByTask}
            checklistByTask={checklistByTask}
            onUpdateStatus={handleUpdateStatus}
            onCreate={handleCreateTask}
            onOpenDetail={setDetailTarget}
            onOpenLead={setDetailLead}
          />
        )}

        {activeView === "comercial" && (
          <ComercialView
            leads={leads}
            team={ownerAndStaff}
            lockedClinicaId={isOwner ? effectiveClinica : user.clinicaId}
            currentUserId={user.id}
            canDelete={canManage}
            onCreate={handleCreateLead}
            onImport={handleImportLeads}
            onChangeStage={handleChangeLeadStage}
            onDelete={handleDeleteLead}
            onOpenDetail={setDetailLead}
          />
        )}

        {activeView === "estoque" && (
          <EstoqueView
            itens={estoque}
            tipo="clinico"
            lockedClinicaId={isOwner ? effectiveClinica : user.clinicaId}
            canManage={canManage}
            onUpdateQty={handleUpdateEstoqueQty}
            onCreateItem={handleCreateEstoqueItem}
            onUpdateItem={handleUpdateEstoqueItem}
            onDeleteItem={handleDeleteEstoqueItem}
            onSolicitarPedido={handleSolicitarPedido}
          />
        )}

        {activeView === "limpeza" && (
          <EstoqueView
            itens={estoque}
            tipo="limpeza_papelaria"
            lockedClinicaId="sorridents"
            canManage={canManage}
            onUpdateQty={handleUpdateEstoqueQty}
            onCreateItem={handleCreateEstoqueItem}
            onUpdateItem={handleUpdateEstoqueItem}
            onDeleteItem={handleDeleteEstoqueItem}
            onSolicitarPedido={handleSolicitarPedido}
          />
        )}

        {isTecnico && activeView === "indicacoes" && (
          <IndicacoesView indicacoes={indicacoes} leads={leads} onCreate={handleCreateIndicacao} />
        )}

        {activeView === "cobrancas" && (
          <CobrancasView
            cobrancas={cobrancas}
            tasks={tasks}
            canDelete={canManage}
            onCreate={handleCreateCobranca}
            onUpdate={handleUpdateCobranca}
            onDelete={handleDeleteCobranca}
            onMarkPaid={(taskId) => handleUpdateStatus(taskId, "concluida")}
            onUndoPaid={(taskId) => handleUpdateStatus(taskId, "pendente")}
          />
        )}
      </div>

      {detailLead && (
        <LeadModal
          lead={leads.find((l) => l.id === detailLead.id) || detailLead}
          team={ownerAndStaff}
          currentUserId={user.id}
          canDelete={canManage}
          onClose={() => setDetailLead(null)}
          onSave={(patch) => handleUpdateLead(detailLead.id, patch)}
          onDelete={handleDeleteLead}
        />
      )}

      {detailTarget && (
        <TaskDetailModal
          task={tasks.find((t) => t.id === detailTarget.id) || detailTarget}
          team={ownerAndStaff}
          currentUser={user}
          canManage={canManage}
          assignableOptions={assignableOptions}
          attachments={attachmentsByTask[detailTarget.id] || []}
          comments={commentsByTask[detailTarget.id] || []}
          checklist={checklistByTask[detailTarget.id] || []}
          activity={activityByTask[detailTarget.id] || []}
          onClose={() => setDetailTarget(null)}
          onUploadAttachment={uploadAttachment}
          onDeleteAttachment={deleteAttachment}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          onAddChecklistItem={handleAddChecklistItem}
          onToggleChecklistItem={handleToggleChecklistItem}
          onDeleteChecklistItem={handleDeleteChecklistItem}
          onUpdatePriority={handleUpdatePriority}
          onUpdateCategoria={handleUpdateCategoria}
          onDelegate={handleDelegate}
          onStopRecurrence={handleStopRecurrence}
          onGoToCobrancas={() => setView("cobrancas")}
          onGoToLead={() => {
            const t = tasks.find((x) => x.id === detailTarget.id) || detailTarget;
            const l = leads.find((x) => x.id === t.leadId);
            if (l) {
              setDetailTarget(null);
              setDetailLead(l);
            }
          }}
          onUpdateStatus={handleUpdateStatus}
        />
      )}
    </div>
  );
}
