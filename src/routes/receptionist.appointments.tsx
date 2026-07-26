import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { fetchRecentAppointments, createAppointment } from "@/lib/clinic-data";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/receptionist/appointments")({ component: ReceptionAppointments });

function ReceptionAppointments() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["recent-appointments"],
    queryFn: fetchRecentAppointments,
  });

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    patientId: "",
    clinician: "",
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    type: "Consultation",
  });

  const create = useMutation({
    mutationFn: () => createAppointment(draft),
    onSuccess: () => {
      toast.success(`Appointment booked for ${draft.patientId} on ${draft.date} at ${draft.time}`);
      setDraft({ ...draft, patientId: "" });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["recent-appointments"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not book appointment"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim()) return toast.error("Patient ID is required (e.g. Pat-828)");
    if (!draft.clinician.trim()) return toast.error("Clinician is required (e.g. Doc-2 or Nur-315)");
    create.mutate();
  };

  return (
    <AppShell role="receptionist" title="Appointments">
      <div className="bg-white rounded-xl border">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="font-semibold">Latest Appointments</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading ? "Loadingâ€¦" : "25 most recent, clinic-wide"}
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.5_0.18_245)]"
          >
            <Plus size={14} /> New
          </button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="p-5 border-b bg-secondary/40 grid grid-cols-1 md:grid-cols-5 gap-3">
            <Field label="Patient ID" value={draft.patientId} onChange={(v) => setDraft({ ...draft, patientId: v })} placeholder="e.g. Pat-828" />
            <Field label="Clinician" value={draft.clinician} onChange={(v) => setDraft({ ...draft, clinician: v })} placeholder="Doc-2 / Nur-315" />
            <Field label="Date" type="date" value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
            <Field label="Time" type="time" value={draft.time} onChange={(v) => setDraft({ ...draft, time: v })} />
            <Field label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} />
            <div className="md:col-span-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="border px-3 py-1.5 rounded-md text-sm">Cancel</button>
              <button type="submit" disabled={create.isPending} className="bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-60">
                {create.isPending ? "Bookingâ€¦" : "Book appointment"}
              </button>
            </div>
          </form>
        )}

        {isError && <p className="text-sm text-destructive p-5">Could not load appointments.</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Clinician</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3 font-mono">{a.date} {a.time}</td>
                  <td className="px-5 py-3 font-medium">{a.patientName}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.clinician}</td>
                  <td className="px-5 py-3">{a.type}</td>
                  <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No appointments found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
      />
    </div>
  );
}
