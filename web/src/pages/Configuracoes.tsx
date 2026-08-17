import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate } from "../lib/format";

interface Municipality {
  id: number;
  name: string;
  state: string;
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

type Tab = "municipios" | "medicos" | "procedimentos" | "valores" | "agendas" | "whatsapp";

const TABS: { id: Tab; label: string }[] = [
  { id: "municipios", label: "Municípios" },
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
        description="A base que o resto do sistema usa."
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
      {tab === "medicos" && <DoctorsTab />}
      {tab === "procedimentos" && <ProceduresTab />}
      {tab === "valores" && <DoctorProceduresTab />}
      {tab === "agendas" && <AgendasTab />}
      {tab === "whatsapp" && <WhatsappTab />}
    </>
  );
}

/* ---------------- Municípios + Unidades ----------------
   Um fluxo só: cada município já mostra suas unidades embaixo, com "Nova
   unidade" direto ali (sem precisar escolher o município nem trocar de
   aba). Antes eram duas telas separadas — juntar evita ida e volta pra
   cadastrar o básico de uma prefeitura nova. */

function MunicipalitiesTab() {
  const data = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const units = useApi<{ units: Unit[] }>("/api/catalog/units");

  const [municipalityModalOpen, setMunicipalityModalOpen] = useState(false);
  const [municipalityForm, setMunicipalityForm] = useState({ name: "", state: "SC" });
  const [municipalityBusy, setMunicipalityBusy] = useState(false);
  const [municipalityError, setMunicipalityError] = useState<string | null>(null);

  // Unidade nova sempre nasce vinculada a um município já visível na tela —
  // por isso o modal guarda qual município abriu ele, em vez de ter select.
  const [unitModalMunicipality, setUnitModalMunicipality] = useState<Municipality | null>(null);
  const [unitForm, setUnitForm] = useState({ name: "", address: "" });
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);

  async function saveMunicipality() {
    setMunicipalityBusy(true);
    setMunicipalityError(null);
    try {
      await api.post("/api/catalog/municipalities", municipalityForm);
      setMunicipalityModalOpen(false);
      setMunicipalityForm({ name: "", state: "SC" });
      data.reload();
    } catch (err) {
      setMunicipalityError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setMunicipalityBusy(false);
    }
  }

  async function saveUnit() {
    if (!unitModalMunicipality) return;
    setUnitBusy(true);
    setUnitError(null);
    try {
      await api.post("/api/catalog/units", { ...unitForm, municipalityId: unitModalMunicipality.id });
      setUnitModalMunicipality(null);
      setUnitForm({ name: "", address: "" });
      units.reload();
      data.reload();
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setUnitBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setMunicipalityModalOpen(true)}>
          Novo município
        </button>
      </div>

      {data.loading && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}

      <div className="grid gap-3">
        {data.data?.municipalities.map((municipality) => {
          const municipalityUnits = (units.data?.units ?? []).filter(
            (unit) => unit.municipalityId === municipality.id
          );
          return (
            <div key={municipality.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">
                  {municipality.name}
                  <span className="ml-1 text-ink-faint">/{municipality.state}</span>
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint">{municipality._count.appointments} paciente(s)</span>
                  <button
                    type="button"
                    className="btn btn-quiet px-2 py-1 text-xs"
                    onClick={() => {
                      setUnitModalMunicipality(municipality);
                      setUnitForm({ name: "", address: "" });
                      setUnitError(null);
                    }}
                  >
                    Nova unidade
                  </button>
                </div>
              </div>

              {municipalityUnits.length > 0 ? (
                <Table
                  head={
                    <tr>
                      <Th>Unidade</Th>
                      <Th>Endereço</Th>
                    </tr>
                  }
                >
                  {municipalityUnits.map((unit) => (
                    <tr key={unit.id}>
                      <Td>{unit.name}</Td>
                      <Td muted>{unit.address ?? "—"}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="mt-2 text-sm text-ink-faint">Nenhuma unidade cadastrada ainda.</p>
              )}
            </div>
          );
        })}
      </div>

      <FormModal
        open={municipalityModalOpen}
        title="Novo município"
        busy={municipalityBusy}
        error={municipalityError}
        onSubmit={saveMunicipality}
        onCancel={() => setMunicipalityModalOpen(false)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={municipalityForm.name}
            onChange={(e) => setMunicipalityForm({ ...municipalityForm, name: e.target.value })}
            required
          />
        </Field>
        <Field label="UF">
          <input
            className="field"
            maxLength={2}
            value={municipalityForm.state}
            onChange={(e) => setMunicipalityForm({ ...municipalityForm, state: e.target.value.toUpperCase() })}
          />
        </Field>
      </FormModal>

      <FormModal
        open={unitModalMunicipality !== null}
        title={`Nova unidade em ${unitModalMunicipality?.name ?? ""}`}
        description="O endereço aparece na mensagem que o paciente recebe."
        busy={unitBusy}
        error={unitError}
        onSubmit={saveUnit}
        onCancel={() => setUnitModalMunicipality(null)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={unitForm.name}
            onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Endereço" hint="Como deve aparecer para o paciente.">
          <input
            className="field"
            value={unitForm.address}
            onChange={(e) => setUnitForm({ ...unitForm, address: e.target.value })}
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

      <div className="mb-3">
        <Callout>
          🚧 O financeiro (valor pago ao médico, cobrado da prefeitura e margem) está <b>em desenvolvimento</b> —
          os campos ficam desabilitados por enquanto. Tempo por consulta e esperado/dia continuam valendo normal
          (alimentam a sugestão de confirmações).
        </Callout>
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
              <Th align="right">Paga ao médico 🚧</Th>
              <Th align="right">Cobra da prefeitura 🚧</Th>
              <Th align="right">Margem 🚧</Th>
            </tr>
          }
        >
          {rows.map(({ doctor, item }) => {
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
                {/* Financeiro em desenvolvimento: mostra sempre "—", nunca o valor
                    cadastrado antigo (se algum sobrou de antes da decisão de
                    escopo de 2026-08-09). */}
                <Td align="right" muted>
                  —
                </Td>
                <Td align="right" muted>
                  —
                </Td>
                <Td align="right" muted>
                  —
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {rows.length === 0 && !doctors.loading && (
        <p className="card p-8 text-center text-sm text-ink-muted">
          Nenhum procedimento configurado por médico ainda. Sem isso a sugestão de confirmações não sabe o
          esperado por dia.
        </p>
      )}

      <FormModal
        open={open}
        title="Procedimento por médico"
        description="Define tempo por consulta e esperado/dia (alimenta a sugestão de confirmações). Os valores financeiros estão em desenvolvimento."
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
          <Field label="Valor pago ao médico" hint="Em desenvolvimento.">
            <input
              className="field"
              inputMode="decimal"
              placeholder="Em desenvolvimento"
              value={form.doctorFee}
              onChange={(e) => setForm({ ...form, doctorFee: e.target.value })}
              disabled
              title="Em desenvolvimento — ainda não disponível."
            />
          </Field>
          <Field label="Valor cobrado da prefeitura" hint="Em desenvolvimento.">
            <input
              className="field"
              inputMode="decimal"
              placeholder="Em desenvolvimento"
              value={form.cityRate}
              onChange={(e) => setForm({ ...form, cityRate: e.target.value })}
              disabled
              title="Em desenvolvimento — ainda não disponível."
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
  /** Configuração separada do Embedded Signup com coexistência habilitada — pra número que já tem WhatsApp Business App. */
  configIdCoexistence: string | null;
  status: {
    connected: boolean;
    source: "signup" | "env" | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    /** Número de verdade formatado pela Meta — o phoneNumberId é só um ID interno, não diz nada pro time/cliente. */
    displayPhoneNumber: string | null;
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
  displayPhoneNumber: string | null;
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

// A Meta manda dois eventos de conclusão diferentes: "FINISH" pra número
// novo/limpo, e "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" quando é
// coexistência (número que já usa o WhatsApp Business App) — ignorar o
// segundo fazia a conexão terminar de verdade do lado da Meta, mas o nosso
// callback nunca rodava, e a tela mostrava "login cancelado" sem ter
// cancelado nada.
const SIGNUP_FINISH_EVENTS = new Set(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]);

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
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);
  const [adopting, setAdopting] = useState(false);
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
        // TEMPORÁRIO (2026-08-16): diagnosticar "Login cancelado" mesmo
        // completando o fluxo até o Finish — logando tudo que chega por
        // postMessage, casando ou não com o que o código já reconhece.
        console.debug("[WHATSAPP SIGNUP] postMessage recebido:", payload);
        if (payload.type === "WA_EMBEDDED_SIGNUP" && SIGNUP_FINISH_EVENTS.has(payload.event)) {
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

  /**
   * @param configId Qual configuração de Embedded Signup usar — a padrão
   *   (número novo/limpo) ou a de coexistência (número que já tem WhatsApp
   *   Business App instalado, ver `configIdCoexistence`). É a configuração
   *   que decide se a Meta oferece a opção de manter o app; não tem nada
   *   pra diferenciar isso nos `extras` do FB.login.
   */
  async function connect(configId: string) {
    if (!data.data?.appId) return;
    setError(null);
    setConnecting(true);
    try {
      await loadFacebookSdk(data.data.appId);
      window.FB?.login(
        (response) => {
          void (async () => {
            // TEMPORÁRIO (2026-08-16): mesmo diagnóstico do lado do
            // FB.login() — response.authResponse costuma vir vazio quando
            // a Meta considera "cancelado", e precisamos ver o que
            // realmente chega pra saber por quê.
            console.debug("[WHATSAPP SIGNUP] FB.login respondeu:", response, "signupData:", signupData.current);
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
          config_id: configId,
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

  /** Vira uma conta de verdade na tabela — mesmo token, só passa a ter apelido/remover pela tela. */
  async function adoptEnv() {
    setError(null);
    setNotice(null);
    setAdopting(true);
    try {
      await api.post("/api/whatsapp/signup/accounts/adopt-env", {});
      // O número continua o mesmo — o card "Em uso agora" some e o mesmo
      // número reaparece na lista abaixo, com editar/remover. Sem aviso,
      // parece que nada mudou.
      setNotice('Número adotado. Ele saiu do card "via variável de ambiente" e passou pra lista abaixo, com apelido e Remover.');
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao adotar o número do .env.");
    } finally {
      setAdopting(false);
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
    setNotice(null);
    try {
      const result = await api.delete<{ status: WhatsappSignupConfig["status"] }>(
        `/api/whatsapp/signup/accounts/${accountId}`
      );
      // Sem isso o resultado fica ambíguo: se sobrar o fallback do .env com o
      // MESMO número que acabou de ser removido, a tela mostra o número
      // idêntico de novo e parece que o "Remover" não fez nada.
      if (result.status.connected && result.status.source === "env") {
        setNotice(
          `Número removido da tela. Como ainda há credencial no .env (número ${result.status.displayPhoneNumber ?? result.status.phoneNumberId}), o envio caiu de volta pra esse fallback — pra desativar de vez, mude as variáveis no ambiente do servidor.`
        );
      } else if (result.status.connected) {
        setNotice(`Número removido. O envio agora está usando outra conta conectada pela tela.`);
      } else {
        setNotice("Número removido. Nenhuma credencial disponível agora — o envio de WhatsApp para até conectar outra.");
      }
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover o número.");
    } finally {
      setRemovingId(null);
    }
  }

  const status = data.data?.status;
  // Sem appId o SDK da Meta nem carrega — os dois botões de conectar ficam
  // desabilitados individualmente se faltar o config_id específico de cada um.
  const missingAppConfig = data.data && !data.data.appId;
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
      {notice && (
        <div className="my-3">
          <Callout>{notice}</Callout>
        </div>
      )}

      {missingAppConfig && (
        <p className="card mt-3 p-4 text-sm text-ink-muted">
          Falta <code>WHATSAPP_APP_ID</code> no ambiente do servidor — sem ele nenhum botão de conectar
          funciona.
        </p>
      )}

      {status?.source === "env" && (
        <div className="card mt-3 p-4 text-sm">
          <p className="font-medium text-ink">Em uso agora — via variável de ambiente (sandbox/dev)</p>
          <p className="text-ink-faint">
            Número {status.displayPhoneNumber ?? status.phoneNumberId} · qualidade{" "}
            {QUALITY_LABEL[status.qualityRating ?? "UNKNOWN"] ?? "Desconhecida"}
          </p>
          <p className="mt-1 text-ink-faint">
            Isso é só o fallback do <code>.env</code> — conecte um número abaixo pra passar a gerenciar pela tela,
            com failover entre dois números.
          </p>
          <button type="button" className="btn btn-quiet mt-2" disabled={adopting} onClick={() => void adoptEnv()}>
            {adopting ? "Adotando…" : "Gerenciar pela tela (apelido/remover)"}
          </button>
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
                  Número {account.displayPhoneNumber ?? account.phoneNumberId} · WABA {account.wabaId}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={connecting || !data.data?.configId}
                onClick={() => data.data?.configId && void connect(data.data.configId)}
                title={!data.data?.configId ? "Falta WHATSAPP_SIGNUP_CONFIG_ID no ambiente." : undefined}
              >
                {connecting
                  ? "Conectando…"
                  : accountList.length > 0
                    ? "Conectar outro número (reserva)"
                    : "Conectar WhatsApp (número novo/limpo)"}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                disabled={connecting || !data.data?.configIdCoexistence}
                onClick={() => data.data?.configIdCoexistence && void connect(data.data.configIdCoexistence)}
                title={
                  !data.data?.configIdCoexistence
                    ? "Falta WHATSAPP_SIGNUP_CONFIG_ID_COEXISTENCE no ambiente."
                    : "Pro número que já tem WhatsApp Business App instalado — a Meta manda um código pro app do celular pra confirmar."
                }
              >
                {connecting ? "Conectando…" : "Conectar número que já usa WhatsApp Business App"}
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
