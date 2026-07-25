import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatMoney } from "../lib/format";

interface Municipality {
  id: number;
  name: string;
  state: string;
  contactName: string | null;
  contactPhone: string | null;
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

type Tab = "municipios" | "unidades" | "medicos" | "procedimentos" | "valores";

const TABS: { id: Tab; label: string }[] = [
  { id: "municipios", label: "Municípios" },
  { id: "unidades", label: "Unidades" },
  { id: "medicos", label: "Médicos" },
  { id: "procedimentos", label: "Procedimentos" },
  { id: "valores", label: "Procedimentos por médico" },
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
    </>
  );
}

/* ---------------- Municípios ---------------- */

function MunicipalitiesTab() {
  const data = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", state: "SC", contactName: "", contactPhone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/catalog/municipalities", form);
      setOpen(false);
      setForm({ name: "", state: "SC", contactName: "", contactPhone: "" });
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
