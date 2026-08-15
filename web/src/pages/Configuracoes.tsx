import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate, formatMoney } from "../lib/format";

interface Municipality {
  id: number;
  name: string;
  state: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  active: boolean;
  _count: { units: number; appointments: number };
}
interface Unit {
  id: number;
  name: string;
  address: string | null;
  municipality: { name: string };
  municipalityId: number;
}
interface Procedure {
  id: number;
  name: string;
  preparationInstructions: string | null;
}
interface DoctorProcedure {
  id: number;
  procedureId: number;
  minutesPerVisit: number | null;
  expectedPerDay: number | null;
  doctorFee: string | null;
  cityRate: string | null;
  procedure: { id: number; name: string };
}
interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
  registration: string | null;
  procedures: DoctorProcedure[];
}

type Tab = "municipios" | "unidades" | "medicos" | "procedimentos" | "valores" | "agendas" | "whatsapp";

const TABS: { id: Tab; label: string }[] = [
  { id: "municipios", label: "Municípios" },
  { id: "unidades", label: "Unidades" },
  { id: "medicos", label: "Médicos" },
  { id: "procedimentos", label: "Procedimentos" },
  { id: "valores", label: "Procedimentos por médico" },
  { id: "agendas", label: "Agendas" },
  { id: "whatsapp", label: "WhatsApp" },
];

export function Configuracoes() {
  const [tab, setTab] = useState<Tab>("municipios");

  return (
    <>
      <PageHeader
        eyebrow="Cadastros"
        title="Configurações"
        description="A base que o resto do sistema usa. Sem valor cadastrado, o fechamento não calcula repasse nem margem."
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-rule">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === item.id
                ? "border-accent font-semibold text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "municipios" && <MunicipalitiesTab />}
      {tab === "unidades" && <UnitsTab />}
      {tab === "medicos" && <DoctorsTab />}
      {tab === "procedimentos" && <ProceduresTab />}
      {tab === "valores" && <DoctorProceduresTab />}
      {tab === "agendas" && <AgendasTab />}
      {tab === "whatsapp" && <WhatsappTab />}
    </>
  );
}

/* ---------------- Municípios ---------------- */

function MunicipalitiesTab() {
  const data = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", state: "SC", contactName: "", contactPhone: "", contactEmail: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/catalog/municipalities", form);
      setOpen(false);
      setForm({ name: "", state: "SC", contactName: "", contactPhone: "", contactEmail: "" });
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Novo município
        </button>
      </div>

      {data.loading && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}

      {data.data && (
        <Table
          head={
            <tr>
              <Th>Município</Th>
              <Th>Contato</Th>
              <Th align="right">Unidades</Th>
              <Th align="right">Pacientes</Th>
            </tr>
          }
        >
          {data.data.municipalities.map((municipality) => (
            <tr key={municipality.id}>
              <Td>
                <span className="font-medium">{municipality.name}</span>
                <span className="ml-1 text-ink-faint">/{municipality.state}</span>
              </Td>
              <Td muted>
                {municipality.contactName ?? "—"}
                {municipality.contactPhone && (
                  <p className="text-xs text-ink-faint">{municipality.contactPhone}</p>
                )}
                {municipality.contactEmail && (
                  <p className="text-xs text-ink-faint">{municipality.contactEmail}</p>
                )}
              </Td>
              <Td align="right" muted>
                {municipality._count.units}
              </Td>
              <Td align="right" muted>
                {municipality._count.appointments}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={open}
        title="Novo município"
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="UF">
          <input
            className="field"
            maxLength={2}
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Contato na secretaria">
          <input
            className="field"
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
          />
        </Field>
        <Field label="Telefone do contato">
          <input
            className="field"
            value={form.contactPhone}
            onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
          />
        </Field>
        <Field
          label="E-mail do contato"
          hint="O relatório de confirmações é enviado pra cá quando a equipe conclui a lista."
        >
          <input
            type="email"
            className="field"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
          />
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------- Unidades ---------------- */

function UnitsTab() {
  const data = useApi<{ units: Unit[] }>("/api/catalog/units");
  const municipalities = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ municipalityId: "", name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/catalog/units", { ...form, municipalityId: Number(form.municipalityId) });
      setOpen(false);
      setForm({ municipalityId: "", name: "", address: "" });
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Nova unidade
        </button>
      </div>

      {data.loading && <Spinner />}
      {data.data && (
        <Table
          head={
            <tr>
              <Th>Unidade</Th>
              <Th>Município</Th>
              <Th>Endereço</Th>
            </tr>
          }
        >
          {data.data.units.map((unit) => (
            <tr key={unit.id}>
              <Td>{unit.name}</Td>
              <Td muted>{unit.municipality.name}</Td>
              <Td muted>{unit.address ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={open}
        title="Nova unidade"
        description="O endereço aparece na mensagem que o paciente recebe."
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Município">
          <select
            className="field"
            value={form.municipalityId}
            onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {municipalities.data?.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome">
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Endereço" hint="Como deve aparecer para o paciente.">
          <input
            className="field"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------- Médicos ---------------- */

function DoctorsTab() {
  const data = useApi<{ doctors: Doctor[] }>("/api/catalog/doctors");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", specialty: "", registration: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/catalog/doctors", form);
      setOpen(false);
      setForm({ name: "", specialty: "", registration: "" });
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Novo médico
        </button>
      </div>

      {data.loading && <Spinner />}
      {data.data && (
        <Table
          head={
            <tr>
              <Th>Médico</Th>
              <Th>Especialidade</Th>
              <Th>Registro</Th>
              <Th align="right">Procedimentos</Th>
            </tr>
          }
        >
          {data.data.doctors.map((doctor) => (
            <tr key={doctor.id}>
              <Td>{doctor.name}</Td>
              <Td muted>{doctor.specialty ?? "—"}</Td>
              <Td muted>{doctor.registration ?? "—"}</Td>
              <Td align="right" muted>
                {doctor.procedures.length}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={open}
        title="Novo médico"
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Especialidade">
          <input
            className="field"
            value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value })}
          />
        </Field>
        <Field label="Registro (CRM)">
          <input
            className="field"
            value={form.registration}
            onChange={(e) => setForm({ ...form, registration: e.target.value })}
          />
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------- Procedimentos ---------------- */

function ProceduresTab() {
  const data = useApi<{ procedures: Procedure[] }>("/api/catalog/procedures");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", preparationInstructions: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/catalog/procedures", form);
      setOpen(false);
      setForm({ name: "", preparationInstructions: "" });
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Novo procedimento
        </button>
      </div>

      {data.loading && <Spinner />}
      {data.data && (
        <Table
          head={
            <tr>
              <Th>Procedimento</Th>
              <Th>Preparo enviado ao paciente</Th>
            </tr>
          }
        >
          {data.data.procedures.map((procedure) => (
            <tr key={procedure.id}>
              <Td>{procedure.name}</Td>
              <Td muted>{procedure.preparationInstructions ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={open}
        title="Novo procedimento"
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field
          label="Preparo"
          hint="Vai no lembrete da véspera. Ex.: compareça em jejum de 8 horas."
        >
          <textarea
            className="field"
            rows={2}
            value={form.preparationInstructions}
            onChange={(e) => setForm({ ...form, preparationInstructions: e.target.value })}
          />
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------- Procedimento por médico (valores) ---------------- */

function DoctorProceduresTab() {
  const doctors = useApi<{ doctors: Doctor[] }>("/api/catalog/doctors");
  const procedures = useApi<{ procedures: Procedure[] }>("/api/catalog/procedures");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    doctorId: "",
    procedureId: "",
    minutesPerVisit: "",
    expectedPerDay: "",
    doctorFee: "",
    cityRate: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/catalog/doctor-procedures", {
        doctorId: Number(form.doctorId),
        procedureId: Number(form.procedureId),
        minutesPerVisit: form.minutesPerVisit ? Number(form.minutesPerVisit) : null,
        expectedPerDay: form.expectedPerDay ? Number(form.expectedPerDay) : null,
        doctorFee: form.doctorFee ? Number(form.doctorFee.replace(",", ".")) : null,
        cityRate: form.cityRate ? Number(form.cityRate.replace(",", ".")) : null,
      });
      setOpen(false);
      doctors.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const rows = (doctors.data?.doctors ?? []).flatMap((doctor) =>
    doctor.procedures.map((item) => ({ doctor, item }))
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Configurar
        </button>
      </div>

      {doctors.loading && <Spinner />}
      {rows.length > 0 && (
        <Table
          head={
            <tr>
              <Th>Médico</Th>
              <Th>Procedimento</Th>
              <Th align="right">Min/consulta</Th>
              <Th align="right">Esperado/dia</Th>
              <Th align="right">Paga ao médico</Th>
              <Th align="right">Cobra da prefeitura</Th>
              <Th align="right">Margem</Th>
            </tr>
          }
        >
          {rows.map(({ doctor, item }) => {
            const fee = item.doctorFee ? Number(item.doctorFee) : null;
            const rate = item.cityRate ? Number(item.cityRate) : null;
            return (
              <tr key={item.id}>
                <Td>{doctor.name}</Td>
                <Td muted>{item.procedure.name}</Td>
                <Td align="right" muted>
                  {item.minutesPerVisit ?? "—"}
                </Td>
                <Td align="right" muted>
                  {item.expectedPerDay ?? "—"}
                </Td>
                <Td align="right">{formatMoney(fee)}</Td>
                <Td align="right">{formatMoney(rate)}</Td>
                <Td align="right">{fee !== null && rate !== null ? formatMoney(rate - fee) : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      )}

      {rows.length === 0 && !doctors.loading && (
        <p className="card p-8 text-center text-sm text-ink-muted">
          Nenhum valor configurado. Sem isso o fechamento não calcula repasse nem margem.
        </p>
      )}

      <FormModal
        open={open}
        title="Procedimento por médico"
        description="Define a capacidade do dia e os valores que alimentam o financeiro."
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Médico">
          <select
            className="field"
            value={form.doctorId}
            onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {doctors.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Procedimento">
          <select
            className="field"
            value={form.procedureId}
            onChange={(e) => setForm({ ...form, procedureId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {procedures.data?.procedures.map((procedure) => (
              <option key={procedure.id} value={procedure.id}>
                {procedure.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Minutos por consulta">
            <input
              type="number"
              min={1}
              className="field"
              value={form.minutesPerVisit}
              onChange={(e) => setForm({ ...form, minutesPerVisit: e.target.value })}
            />
          </Field>
          <Field label="Esperado por dia">
            <input
              type="number"
              min={1}
              className="field"
              value={form.expectedPerDay}
              onChange={(e) => setForm({ ...form, expectedPerDay: e.target.value })}
            />
          </Field>
          <Field label="Valor pago ao médico">
            <input
              className="field"
              inputMode="decimal"
              placeholder="0,00"
              value={form.doctorFee}
              onChange={(e) => setForm({ ...form, doctorFee: e.target.value })}
            />
          </Field>
          <Field label="Valor cobrado da prefeitura">
            <input
              className="field"
              inputMode="decimal"
              placeholder="0,00"
              value={form.cityRate}
              onChange={(e) => setForm({ ...form, cityRate: e.target.value })}
            />
          </Field>
        </div>
      </FormModal>
    </>
  );
}

/* ---------------- Agendas ---------------- */

interface Agenda {
  id: number;
  date: string;
  shift: string;
  capacity: number | null;
  doctor: { id: number; name: string };
  municipality: { id: number; name: string };
  unit: { id: number; name: string } | null;
  procedure: { id: number; name: string } | null;
  _count: { lists: number; appointments: number };
}

interface OpenSlot {
  id: number;
  scheduledAt: string;
  status: string;
  patient: { name: string };
  procedure: { name: string };
}

const SHIFT_LABEL: Record<string, string> = { MANHA: "Manhã", TARDE: "Tarde", INTEGRAL: "Dia todo" };

function AgendasTab() {
  const data = useApi<{ agendas: Agenda[] }>("/api/agendas");
  const doctors = useApi<{ doctors: Doctor[] }>("/api/catalog/doctors");
  const municipalities = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const procedures = useApi<{ procedures: Procedure[] }>("/api/catalog/procedures");
  const units = useApi<{ units: Unit[] }>("/api/catalog/units");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    doctorId: "",
    municipalityId: "",
    unitId: "",
    procedureId: "",
    date: "",
    shift: "INTEGRAL",
    capacity: "",
  });
  // A unidade é o que dá o endereço pra mensagem de WhatsApp — só faz
  // sentido escolher depois do município, senão a lista viria cheia de
  // unidades de outras cidades.
  const unitOptions = (units.data?.units ?? []).filter(
    (unit) => String(unit.municipalityId) === form.municipalityId
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewingSlots, setViewingSlots] = useState<Agenda | null>(null);
  const [deleting, setDeleting] = useState<Agenda | null>(null);
  const slots = useApi<{ slots: OpenSlot[] }>(
    viewingSlots ? `/api/agendas/${viewingSlots.id}/open-slots` : null,
    [viewingSlots?.id]
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/agendas", {
        doctorId: Number(form.doctorId),
        municipalityId: Number(form.municipalityId),
        unitId: form.unitId ? Number(form.unitId) : null,
        procedureId: form.procedureId ? Number(form.procedureId) : null,
        date: form.date,
        shift: form.shift,
        capacity: form.capacity ? Number(form.capacity) : null,
      });
      setOpen(false);
      setForm({
        doctorId: "",
        municipalityId: "",
        unitId: "",
        procedureId: "",
        date: "",
        shift: "INTEGRAL",
        capacity: "",
      });
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/api/agendas/${deleting.id}`);
      setDeleting(null);
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Callout>
        Cadastrar a agenda antes da lista chegar é o que permite ao sistema saber a capacidade esperada
        do dia. Quando alguém recusa ou não responde, o horário fica "aberto" — a lista de vagas abaixo é
        o que volta pra secretaria pedir substitutos, e a lista complementar que ela mandar se vincula à
        mesma agenda.
      </Callout>

      <div className="my-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Nova agenda
        </button>
      </div>

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {data.loading && <Spinner />}
      {data.data && (
        <Table
          head={
            <tr>
              <Th>Data</Th>
              <Th>Médico</Th>
              <Th>Município</Th>
              <Th>Unidade</Th>
              <Th align="right">Capacidade</Th>
              <Th align="right">Vagas abertas</Th>
              <Th align="right">Ações</Th>
            </tr>
          }
        >
          {data.data.agendas.map((agenda) => (
            <tr key={agenda.id}>
              <Td>
                {formatDate(agenda.date)}
                <p className="text-xs text-ink-faint">{SHIFT_LABEL[agenda.shift] ?? agenda.shift}</p>
              </Td>
              <Td muted>
                {agenda.doctor.name}
                {agenda.procedure && <p className="text-xs text-ink-faint">{agenda.procedure.name}</p>}
              </Td>
              <Td muted>{agenda.municipality.name}</Td>
              <Td muted>{agenda.unit ? agenda.unit.name : <span className="italic text-ink-faint">sem unidade</span>}</Td>
              <Td align="right" muted>
                {agenda.capacity ?? "—"}
              </Td>
              <Td align="right" muted>
                {agenda._count.appointments}
              </Td>
              <Td align="right">
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    className="btn btn-quiet px-2 py-1 text-xs"
                    onClick={() => setViewingSlots(agenda)}
                  >
                    Vagas abertas
                  </button>
                  {agenda._count.lists === 0 && (
                    <button
                      type="button"
                      className="btn btn-quiet px-2 py-1 text-xs"
                      onClick={() => setDeleting(agenda)}
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={open}
        title="Nova agenda"
        description="A capacidade do dia alimenta a sugestão de confirmações na revisão da lista."
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <Field label="Médico">
          <select
            className="field"
            value={form.doctorId}
            onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {doctors.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Município">
          <select
            className="field"
            value={form.municipalityId}
            onChange={(e) => setForm({ ...form, municipalityId: e.target.value, unitId: "" })}
            required
          >
            <option value="">Selecione…</option>
            {municipalities.data?.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Unidade"
          hint="Dá o endereço que entra na mensagem de WhatsApp — sem isso, a confirmação sai só com o nome do município."
        >
          <select
            className="field"
            value={form.unitId}
            onChange={(e) => setForm({ ...form, unitId: e.target.value })}
            disabled={!form.municipalityId}
          >
            <option value="">Não especificada</option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {!unit.address ? " (sem endereço cadastrado)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Procedimento" hint="Opcional — deixe em branco se a agenda cobre vários.">
          <select
            className="field"
            value={form.procedureId}
            onChange={(e) => setForm({ ...form, procedureId: e.target.value })}
          >
            <option value="">Não especificado</option>
            {procedures.data?.procedures.map((procedure) => (
              <option key={procedure.id} value={procedure.id}>
                {procedure.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Data">
            <input
              type="date"
              className="field"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
          <Field label="Turno">
            <select className="field" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              <option value="MANHA">Manhã</option>
              <option value="TARDE">Tarde</option>
              <option value="INTEGRAL">Dia todo</option>
            </select>
          </Field>
          <Field label="Capacidade">
            <input
              type="number"
              min={1}
              className="field"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </Field>
        </div>
      </FormModal>

      <FormModal
        open={viewingSlots !== null}
        title={viewingSlots ? `Vagas abertas — ${viewingSlots.doctor.name}, ${formatDate(viewingSlots.date)}` : ""}
        description="Recusas, sem resposta e sem telefone. Devolva esta lista pra secretaria pedir substitutos."
        submitLabel="Baixar CSV"
        onSubmit={() => {
          if (viewingSlots) window.open(`/api/agendas/${viewingSlots.id}/open-slots/export`, "_blank");
        }}
        onCancel={() => setViewingSlots(null)}
      >
        {slots.loading && <Spinner />}
        {slots.data?.slots.length === 0 && (
          <p className="text-sm text-ink-muted">Nenhuma vaga aberta nesta agenda.</p>
        )}
        {(slots.data?.slots.length ?? 0) > 0 && (
          <ul className="grid gap-1.5 text-sm">
            {slots.data?.slots.map((slot) => (
              <li key={slot.id} className="flex justify-between gap-3 border-b border-rule pb-1.5">
                <span>
                  {slot.patient.name}
                  <span className="ml-1 text-xs text-ink-faint">{slot.procedure.name}</span>
                </span>
                <span className="tabular shrink-0 text-ink-faint">
                  {new Date(slot.scheduledAt).toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FormModal>

      <ConfirmModal
        open={deleting !== null}
        title="Excluir esta agenda?"
        description="Só é possível quando nenhuma lista foi vinculada a ela ainda."
        confirmLabel="Excluir"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

/* ---------------- WhatsApp (Embedded Signup) ---------------- */

interface WhatsappSignupConfig {
  appId: string | null;
  configId: string | null;
  status: {
    connected: boolean;
    source: "signup" | "env" | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    businessName: string | null;
    connectedAt: string | null;
    qualityRating: string | null;
    messagingLimitTier: string | null;
    dailyLimit: number;
  };
}

interface WhatsappAccountSummary {
  id: number;
  wabaId: string;
  phoneNumberId: string;
  label: string | null;
  businessName: string | null;
  active: boolean;
  connectedAt: string;
}

const QUALITY_LABEL: Record<string, string> = {
  GREEN: "Boa",
  YELLOW: "Média",
  RED: "Baixa — risco de bloqueio, considere reconectar em outro número",
  UNKNOWN: "Desconhecida",
};

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const FB_SDK_ID = "facebook-jssdk";

function loadFacebookSdk(appId: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) return resolve();
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: "v21.0" });
      resolve();
    };
    if (document.getElementById(FB_SDK_ID)) return;
    const script = document.createElement("script");
    script.id = FB_SDK_ID;
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    document.body.appendChild(script);
  });
}

function WhatsappTab() {
  const data = useApi<WhatsappSignupConfig>("/api/whatsapp/signup/config");
  const accounts = useApi<{ accounts: WhatsappAccountSummary[] }>("/api/whatsapp/signup/accounts");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const signupData = useRef<{ wabaId: string; phoneNumberId: string; businessName: string | null } | null>(null);

  function reloadAll() {
    data.reload();
    accounts.reload();
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "WA_EMBEDDED_SIGNUP" && payload.event === "FINISH") {
          signupData.current = {
            wabaId: payload.data?.waba_id,
            phoneNumberId: payload.data?.phone_number_id,
            businessName: payload.data?.business_name ?? null,
          };
        }
      } catch {
        // mensagens de outra origem/formato — ignora
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function connect() {
    if (!data.data?.appId || !data.data?.configId) return;
    setError(null);
    setConnecting(true);
    try {
      await loadFacebookSdk(data.data.appId);
      window.FB?.login(
        (response) => {
          void (async () => {
            const code = response.authResponse?.code;
            if (!code || !signupData.current?.wabaId || !signupData.current?.phoneNumberId) {
              setConnecting(false);
              setError("Login cancelado ou incompleto — tente novamente.");
              return;
            }
            try {
              await api.post("/api/whatsapp/signup/callback", { code, ...signupData.current });
              reloadAll();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Falha ao concluir a conexão.");
            } finally {
              setConnecting(false);
            }
          })();
        },
        {
          config_id: data.data.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} },
        }
      );
    } catch {
      setConnecting(false);
      setError("Falha ao carregar o SDK da Meta.");
    }
  }

  async function activate(accountId: number) {
    setError(null);
    setSwitching(accountId);
    try {
      await api.post(`/api/whatsapp/signup/accounts/${accountId}/activate`, {});
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar o número ativo.");
    } finally {
      setSwitching(null);
    }
  }

  async function rename(accountId: number) {
    setError(null);
    try {
      await api.patch(`/api/whatsapp/signup/accounts/${accountId}`, { label: editValue });
      accounts.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao renomear.");
    } finally {
      setEditingId(null);
    }
  }

  async function remove(accountId: number) {
    setError(null);
    try {
      await api.delete(`/api/whatsapp/signup/accounts/${accountId}`);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover o número.");
    } finally {
      setRemovingId(null);
    }
  }

  const status = data.data?.status;
  const missingAppConfig = data.data && (!data.data.appId || !data.data.configId);
  const accountList = accounts.data?.accounts ?? [];
  const removingAccount = accountList.find((account) => account.id === removingId);

  return (
    <>
      <Callout>
        Conecte a conta do WhatsApp Business da DGS pra habilitar o envio de mensagens. Dá pra conectar um
        segundo número de reserva e trocar qual está em uso a qualquer momento, sem mexer em nada além
        desta tela — útil se o número em uso for bloqueado pela Meta.
      </Callout>

      {(data.loading || accounts.loading) && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}
      {accounts.error && <ErrorNote message={accounts.error} />}
      {error && (
        <div className="my-3">
          <ErrorNote message={error} />
        </div>
      )}

      {missingAppConfig && (
        <p className="card mt-3 p-4 text-sm text-ink-muted">
          Faltam <code>WHATSAPP_APP_ID</code> e/ou <code>WHATSAPP_SIGNUP_CONFIG_ID</code> no ambiente do
          servidor — sem eles o botão de conectar não pode aparecer.
        </p>
      )}

      {status?.source === "env" && (
        <div className="card mt-3 p-4 text-sm">
          <p className="font-medium text-ink">Em uso agora — via variável de ambiente (sandbox/dev)</p>
          <p className="text-ink-faint">
            Número {status.phoneNumberId} · qualidade {QUALITY_LABEL[status.qualityRating ?? "UNKNOWN"] ?? "Desconhecida"}
          </p>
          <p className="mt-1 text-ink-faint">
            Isso é só o fallback do <code>.env</code> — conecte um número abaixo pra passar a gerenciar pela tela,
            com failover entre dois números.
          </p>
        </div>
      )}

      <>
        {accountList.length === 0 && !accounts.loading && (
          <p className="card mt-3 p-4 text-sm text-ink-muted">
            {status?.source === "env"
              ? "Nenhum número conectado pela tela ainda — o envio está usando só o fallback do .env acima."
              : "Nenhuma conta do WhatsApp conectada ainda."}
          </p>
        )}

          {accountList.map((account) => (
            <div
              key={account.id}
              className={`card mt-3 flex flex-wrap items-center justify-between gap-3 p-4 ${
                account.active ? "border-accent" : ""
              }`}
            >
              <div className="min-w-0 text-sm">
                {editingId === account.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="field"
                      autoFocus
                      placeholder={account.businessName ?? "Apelido (ex.: Principal)"}
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void rename(account.id);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                    />
                    <button type="button" className="btn btn-primary" onClick={() => void rename(account.id)}>
                      Salvar
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setEditingId(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <p className="font-medium text-ink">
                    {account.label ?? account.businessName ?? "Sem nome de exibição"}
                    {account.active && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                        Ativo
                      </span>
                    )}
                    <button
                      type="button"
                      title="Editar apelido"
                      className="ml-2 text-xs font-normal text-ink-faint underline underline-offset-2 hover:text-ink"
                      onClick={() => {
                        setEditValue(account.label ?? "");
                        setEditingId(account.id);
                      }}
                    >
                      editar
                    </button>
                  </p>
                )}
                {account.label && account.businessName && (
                  <p className="text-ink-faint">Nome na Meta: {account.businessName}</p>
                )}
                <p className="text-ink-faint">
                  WABA {account.wabaId} · número {account.phoneNumberId}
                </p>
                <p className="mt-1 text-ink-faint">
                  Conectado em {formatDate(account.connectedAt)}
                  {account.active && status && (
                    <>
                      {" · "}
                      Qualidade: {QUALITY_LABEL[status.qualityRating ?? "UNKNOWN"] ?? "Desconhecida"}
                      {" · "}
                      Limite diário: {status.dailyLimit.toLocaleString("pt-BR")} mensagens
                    </>
                  )}
                </p>
              </div>

              <div className="flex gap-2">
                {!account.active && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={switching === account.id}
                    onClick={() => void activate(account.id)}
                  >
                    {switching === account.id ? "Trocando…" : "Usar este número"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={switching === account.id}
                  onClick={() => setRemovingId(account.id)}
                >
                  Remover
                </button>
              </div>
            </div>
          ))}

          {!missingAppConfig && (
            <div className="mt-3">
              <button type="button" className="btn btn-quiet" disabled={connecting} onClick={connect}>
                {connecting
                  ? "Conectando…"
                  : accountList.length > 0
                    ? "Conectar outro número (reserva)"
                    : "Conectar WhatsApp"}
              </button>
            </div>
          )}
      </>

      {status?.connected && <WhatsappTestSend />}

      <ConfirmModal
        open={removingId !== null}
        title="Remover este número?"
        description={
          removingAccount?.active
            ? "Esse é o número em uso agora — removendo, o disparo de mensagens para até você conectar ou ativar outro."
            : "O envio continua pelo número ativo. Só remove esse de reserva."
        }
        confirmLabel="Remover"
        danger
        onConfirm={() => removingId !== null && void remove(removingId)}
        onCancel={() => setRemovingId(null)}
      />
    </>
  );
}

const TEMPLATE_OPTIONS = [
  { value: "CONFIRMACAO", label: "Confirmação de consulta" },
  { value: "LEMBRETE", label: "Lembrete de véspera" },
  { value: "VAGA_ABERTA", label: "Vaga aberta" },
] as const;

/**
 * Manda um template com dados fictícios pra um número próprio, nunca pra
 * paciente — o backend (`/api/whatsapp/signup/test-send`) não consulta
 * agendamento nenhum, só usa o telefone digitado aqui.
 */
function WhatsappTestSend() {
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState<(typeof TEMPLATE_OPTIONS)[number]["value"]>("CONFIRMACAO");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ stubbed: boolean }>("/api/whatsapp/signup/test-send", {
        phone,
        template,
      });
      setNotice(
        result.stubbed
          ? "Sem credencial real configurada — o envio só foi logado no servidor, nada saiu pelo WhatsApp."
          : "Mensagem de teste enviada. Confira no celular informado."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar o teste.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card mt-3 p-4">
      <p className="eyebrow">Enviar teste</p>
      <p className="mt-1 text-sm text-ink-muted">
        Manda o template com dados fictícios pra um número seu, pra conferir formatação e entrega sem
        risco de mensagem chegar num paciente de verdade.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Seu número (com DDD)">
          <input
            className="field"
            placeholder="(47) 99999-9999"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label="Template">
          <select className="field" value={template} onChange={(event) => setTemplate(event.target.value as typeof template)}>
            {TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={sending || !phone.trim()}
        onClick={() => void handleSend()}
      >
        {sending ? "Enviando…" : "Enviar teste"}
      </button>

      {notice && (
        <div className="mt-3">
          <Callout>{notice}</Callout>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}
