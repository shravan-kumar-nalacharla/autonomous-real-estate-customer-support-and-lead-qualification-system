'use client';

import { useEffect, useState } from 'react';
import { Building2, Loader2, Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface PropertyRow {
  id: string;
  title: string;
  property_type: string;
  listing_type: 'sale' | 'rent';
  status: string;
  location: string;
  locality: string | null;
  bedrooms: number | null;
  price: number;
}

const initialForm = {
  title: '',
  property_type: 'apartment',
  listing_type: 'sale',
  location: '',
  locality: '',
  bedrooms: '',
  price: '',
};

const publicDriveImageIds: Record<string, string> = {
  apartment2: '1kp1lAFvMHRnlZGaDlKkyIbxNbwz_6CL4',
  apartment3: '1lBWwT9bFUo065lpRryqwBOWZJpkZB-8K',
  highrise: '1BSefTRo1WeQQRaXAkACZHhDQwbPx-h0v',
  villa: '1mgt4ftz7-B0IlAyecugxKj-hOVDS3_o9',
  plot: '1gHLUHtSKaovzV0mKyhKdKvccxVfugiAi',
  agricultural_land: '1MYbo8i90XcqCOWVfVONFm7X7MvYKGd1V',
  office: '1OjFmAAEB7ny4b_-ScKe6zPBmOwplOIqv',
  showroom: '1r1-56ZCQvXSVQrkM-H8AyvpUWMnNhq6y',
  shop: '1noYyBDocdpXAU-YfsgNweB6QrQ6B73-m',
  warehouse: '1WOmRJ6GHqomhzycwCRlw0wFewe7iFWLA',
};

function propertyImageUrl(property: PropertyRow) {
  const key =
    property.property_type === 'apartment'
      ? `apartment${property.bedrooms === 2 ? 2 : 3}`
      : property.property_type;
  const fileId = publicDriveImageIds[key];
  return fileId
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
    : `/api/properties/${property.id}/image`;
}

function PropertyImage({ property }: { property: PropertyRow }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative flex aspect-[16/9] items-center justify-center bg-slate-950 text-slate-600">
      {failed ? (
        <Building2
          className="h-9 w-9"
          aria-label="No property image available"
        />
      ) : (
        <img
          src={propertyImageUrl(property)}
          alt={`${property.title} property`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadProperties() {
    setLoading(true);
    try {
      const response = await fetch('/api/properties');
      const json = await response.json();
      if (!response.ok)
        throw new Error(json.error ?? 'Failed to load properties');
      setProperties(json.properties ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load properties'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProperties();
  }, []);

  async function saveProperty() {
    setSaving(true);
    try {
      const response = await fetch(
        editingId ? `/api/properties/${editingId}` : '/api/properties',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...form,
            bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
            price: Number(form.price),
          }),
        }
      );
      const json = await response.json();
      if (!response.ok)
        throw new Error(json.error ?? 'Failed to save property');
      setForm(initialForm);
      setEditingId(null);
      await loadProperties();
      toast.success(editingId ? 'Property updated' : 'Property added');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save property'
      );
    } finally {
      setSaving(false);
    }
  }

  function editProperty(property: PropertyRow) {
    setEditingId(property.id);
    setForm({
      title: property.title,
      property_type: property.property_type,
      listing_type: property.listing_type,
      location: property.location,
      locality: property.locality ?? '',
      bedrooms: property.bedrooms?.toString() ?? '',
      price: property.price.toString(),
    });
    document.getElementById('property-title')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(initialForm);
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
            id="property-title"
            className="md:col-span-2"
            placeholder="Property title"
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
          />
          <Select
            value={form.property_type}
            onValueChange={(value) =>
              setForm((prev) => ({
                ...prev,
                property_type: value ?? 'apartment',
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apartment">Apartment</SelectItem>
              <SelectItem value="highrise">High-rise</SelectItem>
              <SelectItem value="villa">Villa</SelectItem>
              <SelectItem value="plot">Plot</SelectItem>
              <SelectItem value="agricultural_land">
                Agricultural land
              </SelectItem>
              <SelectItem value="office">Office</SelectItem>
              <SelectItem value="showroom">Showroom</SelectItem>
              <SelectItem value="shop">Commercial shop</SelectItem>
              <SelectItem value="warehouse">Warehouse</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={form.listing_type}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, listing_type: value ?? 'sale' }))
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
            onChange={(event) =>
              setForm((prev) => ({ ...prev, location: event.target.value }))
            }
          />
          <Input
            placeholder="BHK"
            value={form.bedrooms}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, bedrooms: event.target.value }))
            }
          />
          <Input
            placeholder="Price"
            value={form.price}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, price: event.target.value }))
            }
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Input
            placeholder="Locality"
            value={form.locality}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, locality: event.target.value }))
            }
          />
          {editingId && (
            <Button variant="ghost" onClick={cancelEditing} disabled={saving}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
          <Button onClick={saveProperty} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : editingId ? (
              <Pencil className="mr-2 h-4 w-4" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {editingId ? 'Update' : 'Add'}
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
          <p className="font-medium text-slate-300">No property records yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Google Drive stores the photos, but each listing still needs its
            property details. Add a property above and its matching Drive image
            will appear on the card.
          </p>
          <Button
            className="mt-4"
            onClick={() => document.getElementById('property-title')?.focus()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add first property
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <div
              key={property.id}
              className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40"
            >
              <PropertyImage property={property} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-white">
                      {property.title}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {[property.locality, property.location]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{property.status}</Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${property.title}`}
                      onClick={() => editProperty(property)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-300">
                  <span>{property.property_type}</span>
                  <span>{property.listing_type}</span>
                  <span>{property.bedrooms ?? '-'} BHK</span>
                  <span>₹{Number(property.price).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
