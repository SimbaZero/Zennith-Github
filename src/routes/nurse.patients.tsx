import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useAllPatients, registerPatient } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/nurse/patients")({ component: NursePatients });

function NursePatients() {
  return (
    <AppShell role="nurse" title="Patient Files">
      <PatientFilesTable recordBase="/nurse/patient-record" />
    </AppShell>
  );
}

export function PatientFilesTable({ recordBase = "/nurse/patient-record" }: { recordBase?: string }) {
  const [q, setQ] = useState("");
  const [showReg, setShowReg] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCondition, setNewCondition] = useState("Hypertension");
  const all = useAllPatients();
  const filtered = all.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.id.toLowerCase().includes(q.toLowerCase()),
  );
  const doRegister = () => {
    const name = newName.trim();
    if (!name) return;
    const rec = registerPatient({ name, condition: newCondition });
    toast.success(`Registered ${rec.name} — ${rec.id}`);
    setNewName(""); setShowReg(false); setQ(name);
  };
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b gap-3 flex-wrap">
        <h3 className="font-semibold">Patient Files</h3>
        <div className="flex items-center gap-2">
          <input
            placeholder="Search name or ID..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
          />
          <button onClick={() => setShowReg((v) => !v)} className="inline-flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-xs hover:bg-[oklch(0.25_0.08_260)]">
            <UserPlus size={12} /> Register new
          </button>
        </div>
      </div>
      {showReg && (
        <div className="p-5 border-b bg-secondary/30 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="text-[10px] tracking-wider text-muted-foreground uppercase block mb-1">Full name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Thandi Mokoena" className="w-full border rounded-md px-3 py-2 text-sm bg-white" />
          </div>
          <div>
            <label className="text-[10px] tracking-wider text-muted-foreground uppercase block mb-1">Primary condition</label>
            <select value={newCondition} onChange={(e) => setNewCondition(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
              {["Hypertension","Diabetes Type 2","HIV","TB","Cardiac","Chronic Kidney Disease","Asthma","None"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button onClick={doRegister} disabled={!newName.trim()} className="bg-[oklch(0.5_0.18_160)] disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.45_0.18_160)]">
            Add patient
          </button>
        </div>
      )}
      {filtered.length === 0 && q.trim() && !showReg && (
        <div className="p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
          <span>No patient matches "{q}".</span>
          <button onClick={() => { setNewName(q); setShowReg(true); }} className="inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-md text-xs hover:bg-secondary">
            <UserPlus size={12} /> Register "{q}"
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="px-5 py-3 font-medium">Patient ID</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Condition</th>
              <th className="px-5 py-3 font-medium">Last Visit</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t hover:bg-secondary/40">
                <td className="px-5 py-3.5 text-muted-foreground">{p.id}</td>
                <td className="px-5 py-3.5 font-medium">{p.name}</td>
                <td className="px-5 py-3.5">{p.condition}</td>
                <td className="px-5 py-3.5 text-muted-foreground">{p.lastVisit}</td>
                <td className="px-5 py-3.5 text-right">
                  <Link
                    to={`${recordBase}/${p.id}` as any}
                    className="border px-3 py-1 rounded-md text-xs hover:bg-secondary"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
