"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AppointmentRow {
  id: string;
  status: string;
  requested_start_at: string | null;
  proposed_start_at: string | null;
  confirmed_start_at: string | null;
  notes: string | null;
  contact:
    | { id?: string; name: string | null; phone: string }
    | { id?: string; name: string | null; phone: string }[]
    | null;
  property:
    | { id?: string; title: string; location: string; locality: string | null }
    | { id?: string; title: string; location: string; locality: string | null }[]
    | null;
  created_at: string;
}

interface SlotRow {
  start_at: string;
  end_at: string;
  agent_id: string | null;
}

interface AvailabilityRule {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  is_active: boolean;
}

function first<T>(value: T[] | T | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function appointmentTime(appointment: AppointmentRow) {
  return (
    appointment.confirmed_start_at ??
    appointment.proposed_start_at ??
    appointment.requested_start_at ??
    appointment.created_at
  );
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [proposedTimes, setProposedTimes] = useState<Record<string, string>>({});
  const [slotDate, setSlotDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [ruleDraft, setRuleDraft] = useState({
    weekday: "0",
    start_time: "10:00",
    end_time: "18:00",
  });

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

  async function loadAvailability() {
    try {
      const response = await fetch("/api/appointments/availability");
      const json = await response.json();
      if (response.ok) setRules(json.rules ?? []);
    } catch {
      setRules([]);
    }
  }

  useEffect(() => {
    void loadAppointments();
    void loadAvailability();
  }, []);

  async function patchAppointment(id: string, body: Record<string, unknown>) {
    setUpdatingId(id);
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
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

  async function loadSlots() {
    try {
      const response = await fetch(`/api/appointments/slots?date=${slotDate}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to load slots");
      setSlots(json.slots ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load slots");
    }
  }

  async function proposeAppointment(appointment: AppointmentRow) {
    const proposed = proposedTimes[appointment.id];
    if (!proposed) {
      toast.error("Choose a time first");
      return;
    }
    await patchAppointment(appointment.id, {
      status: "proposed",
      proposed_start_at: new Date(proposed).toISOString(),
    });
  }

  async function confirmAppointment(appointment: AppointmentRow, slot?: SlotRow) {
    const contact = first(appointment.contact);
    const property = first(appointment.property);
    const rawStart = slot?.start_at ?? proposedTimes[appointment.id];
    if (!rawStart || !contact?.id) {
      toast.error("Choose a time first");
      return;
    }
    const start = rawStart.endsWith("Z") ? rawStart : new Date(rawStart).toISOString();
    const end = slot?.end_at ?? new Date(new Date(start).getTime() + 45 * 60_000).toISOString();

    setUpdatingId(appointment.id);
    try {
      const response = await fetch("/api/appointments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appointment_id: appointment.id,
          contact_id: contact.id,
          property_id: property?.id ?? null,
          slot_start_at: start,
          slot_end_at: end,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to confirm appointment");
      await loadAppointments();
      toast.success("Appointment confirmed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to confirm appointment");
    } finally {
      setUpdatingId(null);
    }
  }

  async function cancelAppointment(id: string) {
    setUpdatingId(id);
    try {
      const response = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointment_id: id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to cancel appointment");
      await loadAppointments();
      toast.success("Appointment cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel appointment");
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveAvailability() {
    try {
      const response = await fetch("/api/appointments/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekday: Number(ruleDraft.weekday),
          start_time: ruleDraft.start_time,
          end_time: ruleDraft.end_time,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to save availability");
      await loadAvailability();
      toast.success("Availability saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save availability");
    }
  }

  const grouped = appointments.reduce<Record<string, AppointmentRow[]>>((acc, appointment) => {
    const key = new Date(appointmentTime(appointment)).toLocaleDateString();
    acc[key] = [...(acc[key] ?? []), appointment];
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Appointments</h1>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={slotDate}
            onChange={(event) => setSlotDate(event.target.value)}
            className="w-40"
          />
          <Button variant="secondary" onClick={loadSlots}>
            <Search className="mr-2 h-4 w-4" />
            Slots
          </Button>
        </div>
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
        <Tabs defaultValue="day" className="space-y-4">
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
          </TabsList>

          <TabsContent value="day" className="space-y-4">
            {slots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {slots.slice(0, 12).map((slot) => (
                  <Badge key={slot.start_at} variant="secondary">
                    <Clock className="mr-1 h-3 w-3" />
                    {new Date(slot.start_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                ))}
              </div>
            )}

            {Object.entries(grouped).map(([date, rows]) => (
              <div key={date} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {date}
                </h2>
                {rows.map((appointment) => {
                  const contact = first(appointment.contact);
                  const property = first(appointment.property);
                  return (
                    <div
                      key={appointment.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-white">
                              {contact?.name || contact?.phone || "Unknown contact"}
                            </h3>
                            <Badge>{appointment.status}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-400">
                            {property
                              ? `${property.title} - ${[
                                  property.locality,
                                  property.location,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}`
                              : "No property selected"}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {new Date(appointmentTime(appointment)).toLocaleString()}
                          </p>
                          {appointment.notes && (
                            <p className="mt-2 text-sm text-slate-300">
                              {appointment.notes}
                            </p>
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
                            onClick={() => proposeAppointment(appointment)}
                          >
                            <RotateCw className="mr-2 h-4 w-4" />
                            Propose
                          </Button>
                          <Button
                            disabled={updatingId === appointment.id}
                            onClick={() => confirmAppointment(appointment)}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Confirm
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={updatingId === appointment.id}
                            onClick={() => patchAppointment(appointment.id, { status: "completed" })}
                          >
                            Done
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={updatingId === appointment.id}
                            onClick={() => patchAppointment(appointment.id, { status: "no_show" })}
                          >
                            No-show
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={updatingId === appointment.id}
                            onClick={() => cancelAppointment(appointment.id)}
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
            ))}
          </TabsContent>

          <TabsContent value="week" className="space-y-3">
            {Object.entries(grouped).map(([date, rows]) => (
              <div
                key={date}
                className="flex items-center justify-between border-b border-slate-800 py-3"
              >
                <span className="font-medium text-white">{date}</span>
                <span className="text-sm text-slate-400">{rows.length} visits</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="availability" className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <Select
                value={ruleDraft.weekday}
                onValueChange={(value) =>
                  setRuleDraft((prev) => ({ ...prev, weekday: value ?? "0" }))
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="time"
                value={ruleDraft.start_time}
                onChange={(event) =>
                  setRuleDraft((prev) => ({ ...prev, start_time: event.target.value }))
                }
                className="w-32"
              />
              <Input
                type="time"
                value={ruleDraft.end_time}
                onChange={(event) =>
                  setRuleDraft((prev) => ({ ...prev, end_time: event.target.value }))
                }
                className="w-32"
              />
              <Button onClick={saveAvailability}>Save</Button>
            </div>
            <div className="divide-y divide-slate-800">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="text-white">
                    {
                      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                        rule.weekday
                      ]
                    }{" "}
                    - {rule.start_time}-{rule.end_time}
                  </span>
                  <Badge variant={rule.is_active ? "default" : "secondary"}>
                    {rule.is_active ? "Active" : "Off"}
                  </Badge>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
