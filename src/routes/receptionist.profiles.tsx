import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/receptionist/profiles")({ component: Profiles });

const all = [
  { id: "P-0481", name: "Thandi Mokoena", cell: "081 234 5678", email: "thandi@example.co.za", dob: "1988-07-14", status: "OK" as const },
  { id: "P-0482", name: "Sipho Dlamini",   cell: "082 345 6789", email: "sipho@example.co.za",  dob: "1979-02-03", status: "OK" as const },
  { id: "P-0483", name: "Ayanda Khumalo",  cell: "083 456 7890", email: "ayanda@example.co.za", dob: "1992-11-22", status: "OK" as const },
  { id: "P-0484", name: "Naledi Tshabalala",cell: "084 567 8901", email: "naledi@example.co.za", dob: "1965-05-09", status: "OK" as const },
  { id: "P-0485", name: "Bongani Nkosi",   cell: "085 678 9012", email: "bongani@example.co.za", dob: "1971-09-30", status: "OK" as const },
];

function Profiles() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((p) => p.name.toLowerCase().includes(t) || p.id.toLowerCase().includes(t));
  }, [q]);

  return (
    <AppShell role="receptionist" title="Patient Profiles">
      <div className="bg-white rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b">
          <h3 className="font-semibold">All Patient Profiles</h3>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID…"
            className="px-3 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Patient ID</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Date of Birth</th>
                <th className="px-5 py-3 font-medium">Cell</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3 text-muted-foreground">{p.id}</td>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.dob}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.cell}</td>
                  <td className="px-5 py-3 text-xs">{p.email}</td>
                  <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => navigate({ to: "/receptionist/registration" })} className="border text-xs px-3 py-1 rounded-md hover:bg-secondary">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 text-xs text-muted-foreground border-t">{filtered.length} / {all.length}</div>
      </div>
    </AppShell>
  );
}
