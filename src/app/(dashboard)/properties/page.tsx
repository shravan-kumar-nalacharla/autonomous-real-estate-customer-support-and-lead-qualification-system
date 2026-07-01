"use client";

import { useEffect, useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface PropertyRow {
  id: string;
  title: string;
  property_type: string;
  listing_type: "sale" | "rent";
  status: string;
  location: string;
  locality: string | null;
  bedrooms: number | null;
  price: number;
}

const initialForm = {
  title: "",
  property_type: "apartment",
  listing_type: "sale",
  location: "",
  locality: "",
  bedrooms: "",
  price: "",
};

export default function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);

  async function loadProperties() {
    setLoading(true);
    try {
      const response = await fetch("/api/properties");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to load properties");
      setProperties(json.properties ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load properties");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProperties();
  }, []);

  async function createProperty() {
    setSaving(true);
    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          price: Number(form.price),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to create property");
      setForm(initialForm);
      await loadProperties();
      toast.success("Property added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create property");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Properties</h1>
          <p className="mt-1 text-sm text-slate-400">
            Organization inventory used by the property matching agent.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <div className="grid gap-3 md:grid-cols-7">
          <Input
            className="md:col-span-2"
            placeholder="Property title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
          <Select
            value={form.property_type}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, property_type: value ?? "apartment" }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apartment">Apartment</SelectItem>
              <SelectItem value="villa">Villa</SelectItem>
              <SelectItem value="plot">Plot</SelectItem>
              <SelectItem value="commercial">Commercial</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={form.listing_type}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, listing_type: value ?? "sale" }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">Sale</SelectItem>
              <SelectItem value="rent">Rent</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Location"
            value={form.location}
            onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
          />
          <Input
            placeholder="BHK"
            value={form.bedrooms}
            onChange={(event) => setForm((prev) => ({ ...prev, bedrooms: event.target.value }))}
          />
          <Input
            placeholder="Price"
            value={form.price}
            onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Input
            placeholder="Locality"
            value={form.locality}
            onChange={(event) => setForm((prev) => ({ ...prev, locality: event.target.value }))}
          />
          <Button onClick={createProperty} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading properties
        </div>
      ) : properties.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-slate-400">
          <Building2 className="mx-auto mb-3 h-8 w-8" />
          No properties yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <div key={property.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">{property.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {[property.locality, property.location].filter(Boolean).join(", ")}
                  </p>
                </div>
                <Badge>{property.status}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-300">
                <span>{property.property_type}</span>
                <span>{property.listing_type}</span>
                <span>{property.bedrooms ?? "-"} BHK</span>
                <span>₹{Number(property.price).toLocaleString("en-IN")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
