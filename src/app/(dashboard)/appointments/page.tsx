"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface AppointmentRow {
  id: string;
  status: string;
  requested_start_at: string | null;
  proposed_start_at: string | null;
  confirmed_start_at: string | null;
  notes: string | null;
  contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null;
  property: { title: string; location: string; locality: string | null }[] | { title: string; location: string; locality: string | null } | null;
  created_at: string;
}

function first<T>(value: T[] | T | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [proposedTimes, setProposedTimes] = useState<Record<string, string>>({});

  async function loadAppointments() {
    setLoading(true);
    try {
      const response = await fetch("/api/appointments");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to load appointments");
      setAppointments(json.appointments ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAppointments();
  }, []);

  async function updateAppointment(id: string, status: string) {
    setUpdatingId(id);
    try {
      const proposed = proposedTimes[id];
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          status,
          proposed_start_at: proposed ? new Date(proposed).toISOString() : undefined,
          confirmed_start_at:
            status === "confirmed"
              ? new Date(proposed || Date.now()).toISOString()
              : undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to update appointment");
      await loadAppointments();
      toast.success("Appointment updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update appointment");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Appointments</h1>
        <p className="mt-1 text-sm text-slate-400">
          Site-visit requests and confirmations created by the appointment agent.
        </p>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading appointments
        </div>
      ) : appointments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-slate-400">
          <CalendarClock className="mx-auto mb-3 h-8 w-8" />
          No appointment requests yet.
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appointment) => {
            const contact = first(appointment.contact);
            const property = first(appointment.property);
            return (
              <div key={appointment.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white">
                        {contact?.name || contact?.phone || "Unknown contact"}
                      </h2>
                      <Badge>{appointment.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {property
                        ? `${property.title} · ${[property.locality, property.location].filter(Boolean).join(", ")}`
                        : "No property selected yet"}
                    </p>
                    {appointment.notes && (
                      <p className="mt-2 text-sm text-slate-300">{appointment.notes}</p>
                    )}
                  </div>
                  <div className="flex min-w-64 flex-wrap items-center gap-2">
                    <Input
                      type="datetime-local"
                      value={proposedTimes[appointment.id] ?? ""}
                      onChange={(event) =>
                        setProposedTimes((prev) => ({
                          ...prev,
                          [appointment.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="secondary"
                      disabled={updatingId === appointment.id}
                      onClick={() => updateAppointment(appointment.id, "proposed")}
                    >
                      Propose
                    </Button>
                    <Button
                      disabled={updatingId === appointment.id}
                      onClick={() => updateAppointment(appointment.id, "confirmed")}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Confirm
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={updatingId === appointment.id}
                      onClick={() => updateAppointment(appointment.id, "cancelled")}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
