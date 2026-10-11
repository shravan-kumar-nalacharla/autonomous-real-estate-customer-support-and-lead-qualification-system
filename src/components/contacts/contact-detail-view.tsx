'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactNote, CustomField, Deal } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  DollarSign,
  Sparkles,
} from 'lucide-react';

interface LeadRequirement {
  updated_at: string;
  customer_role?: string | null;
  listing_intent?: string | null;
  listing_type?: string | null;
  property_category?: string | null;
  property_type?: string | null;
  property_stage?: string | null;
  preferred_locations?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string | null;
  bedrooms?: number | null;
  bedroom_count?: number | null;
  bathrooms?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  area_unit?: string | null;
  plot_facing?: string | null;
  road_width?: string | null;
  approval_authority?: string | null;
  rera_id?: string | null;
  furnishing?: string | null;
  parking_required?: boolean | null;
  amenities?: string[];
  buying_timeline?: string | null;
  timeline?: string | null;
  possession_timeline?: string | null;
  financing_required?: boolean | null;
  financing_interest?: boolean | null;
  loan_preapproved?: boolean | null;
  site_visit_interest?: boolean | null;
  preferred_appointment_at?: string | null;
  preferred_appointment_date?: string | null;
  preferred_appointment_time?: string | null;
  property_reference?: string | null;
  seller_property_details?: Record<string, unknown> | null;
  source?: string | null;
}

interface LeadScore {
  score: number;
  category: 'hot' | 'warm' | 'cold' | 'general_enquiry';
  breakdown: Record<string, unknown> | unknown[];
  explanation: string;
  updated_at: string;
}

const requirementFields: Array<{
  label: string;
  value: (lead: LeadRequirement) => unknown;
}> = [
  { label: 'Customer role', value: (lead) => lead.customer_role },
  {
    label: 'Looking to',
    value: (lead) => lead.listing_intent ?? lead.listing_type,
  },
  { label: 'Category', value: (lead) => lead.property_category },
  { label: 'Property type', value: (lead) => lead.property_type },
  { label: 'Property stage', value: (lead) => lead.property_stage },
  { label: 'Preferred locations', value: (lead) => lead.preferred_locations },
  {
    label: 'Budget minimum',
    value: (lead) => formatMoney(lead.budget_min, lead.currency),
  },
  {
    label: 'Budget maximum',
    value: (lead) => formatMoney(lead.budget_max, lead.currency),
  },
  { label: 'Bedrooms', value: (lead) => lead.bedrooms ?? lead.bedroom_count },
  { label: 'Bathrooms', value: (lead) => lead.bathrooms },
  {
    label: 'Minimum area',
    value: (lead) => formatArea(lead.area_min, lead.area_unit),
  },
  {
    label: 'Maximum area',
    value: (lead) => formatArea(lead.area_max, lead.area_unit),
  },
  { label: 'Plot facing', value: (lead) => lead.plot_facing },
  { label: 'Road width', value: (lead) => lead.road_width },
  { label: 'Approval authority', value: (lead) => lead.approval_authority },
  { label: 'RERA ID', value: (lead) => lead.rera_id },
  { label: 'Furnishing', value: (lead) => lead.furnishing },
  { label: 'Parking required', value: (lead) => lead.parking_required },
  { label: 'Amenities', value: (lead) => lead.amenities },
  {
    label: 'Buying timeline',
    value: (lead) => lead.buying_timeline ?? lead.timeline,
  },
  { label: 'Possession timeline', value: (lead) => lead.possession_timeline },
  {
    label: 'Financing required',
    value: (lead) => lead.financing_required ?? lead.financing_interest,
  },
  { label: 'Loan pre-approved', value: (lead) => lead.loan_preapproved },
  { label: 'Site visit interest', value: (lead) => lead.site_visit_interest },
  {
    label: 'Preferred visit',
    value: (lead) =>
      formatDateTime(lead.preferred_appointment_at) ??
      [lead.preferred_appointment_date, lead.preferred_appointment_time]
        .filter(Boolean)
        .join(' '),
  },
  { label: 'Property reference', value: (lead) => lead.property_reference },
  { label: 'Seller property', value: (lead) => lead.seller_property_details },
  { label: 'Source', value: (lead) => lead.source },
];

function formatMoney(value?: number | null, currency?: string | null) {
  if (value == null) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatArea(value?: number | null, unit?: string | null) {
  return value == null
    ? null
    : `${Number(value).toLocaleString('en-IN')} ${unit ?? 'sq ft'}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function displayValue(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 'unknown'
  )
    return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== null && item !== undefined && item !== ''
    );
    return entries.length
      ? entries
          .map(
            ([key, item]) =>
              `${key.replaceAll('_', ' ')}: ${Array.isArray(item) ? item.join(', ') : String(item)}`
          )
          .join(' · ')
      : null;
  }
  return String(value).replaceAll('_', ' ');
}

function scoreBreakdownEntries(breakdown: LeadScore['breakdown']) {
  if (Array.isArray(breakdown)) {
    return breakdown.map((item, index) => {
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return [
          String(row.reason ?? row.label ?? `Factor ${index + 1}`),
          row.points ?? row.score ?? '',
        ] as const;
      }
      return [`Factor ${index + 1}`, item] as const;
    });
  }
  return Object.entries(breakdown ?? {});
}

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  // Lead profile tab
  const [leadRequirement, setLeadRequirement] =
    useState<LeadRequirement | null>(null);
  const [leadScore, setLeadScore] = useState<LeadScore | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  const fetchLeadProfile = useCallback(async () => {
    if (!contactId) return;
    setLoadingLead(true);
    setLeadRequirement(null);
    setLeadScore(null);

    const [requirementsResult, scoreResult] = await Promise.all([
      supabase
        .from('lead_requirements')
        .select('*')
        .eq('contact_id', contactId)
        .maybeSingle(),
      supabase
        .from('lead_scores')
        .select('score, category, breakdown, explanation, updated_at')
        .eq('contact_id', contactId)
        .maybeSingle(),
    ]);

    if (requirementsResult.error || scoreResult.error) {
      toast.error('Failed to load lead profile');
    } else {
      setLeadRequirement(requirementsResult.data as LeadRequirement | null);
      setLeadScore(scoreResult.data as LeadScore | null);
    }
    setLoadingLead(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchLeadProfile();
    }
  }, [
    open,
    contactId,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchCustomFields,
    fetchDeals,
    fetchLeadProfile,
  ]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error('Failed to update contact');
    } else {
      toast.success('Contact updated');
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (!error) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error('Not authenticated');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('Failed to add note');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Note added');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success('Custom fields saved');
    } catch {
      toast.error('Failed to save custom fields');
    }
    setSavingCustom(false);
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-lg"
      >
        {loading || !contact ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-primary size-6 animate-spin" />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Header */}
            <SheetHeader className="border-b border-slate-700/50 p-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 border border-slate-700 bg-slate-800">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-white">
                    {contact.name || 'Unknown'}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 text-xs text-slate-400">
                    Contact details
                  </SheetDescription>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <button
                      onClick={copyPhone}
                      className="hover:text-primary flex cursor-pointer items-center gap-1 transition-colors"
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                      {copiedPhone ? (
                        <Check className="text-primary size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs
              defaultValue="details"
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mx-4 mt-3 grid h-auto w-auto grid-cols-3 gap-1 border-b border-slate-700 bg-slate-800/50">
                <TabsTrigger
                  value="details"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Details
                </TabsTrigger>
                <TabsTrigger
                  value="lead"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Lead Profile
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Tags
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Fields
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:text-primary text-slate-400 data-active:bg-slate-800"
                >
                  Deals
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent
                value="details"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">Name</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">Email</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">Company</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-800 text-sm text-white"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </TabsContent>

              {/* Lead Profile Tab */}
              <TabsContent
                value="lead"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                {loadingLead ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="text-primary size-5 animate-spin" />
                  </div>
                ) : !leadRequirement && !leadScore ? (
                  <div className="py-12 text-center">
                    <Sparkles className="mx-auto mb-3 size-8 text-slate-600" />
                    <p className="text-sm font-medium text-slate-300">
                      Not qualified yet
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Requirements and scoring will appear after the
                      qualification agent processes this lead.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {leadScore && (
                      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                        <div className="flex items-center gap-4">
                          <div className="border-primary/70 bg-primary/10 flex size-16 shrink-0 items-center justify-center rounded-full border-4 text-xl font-bold text-white">
                            {leadScore.score}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs tracking-wide text-slate-400 uppercase">
                                Lead score
                              </p>
                              <Badge className="capitalize">
                                {leadScore.category.replaceAll('_', ' ')}
                              </Badge>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700">
                              <div
                                className="bg-primary h-full rounded-full"
                                style={{ width: `${leadScore.score}%` }}
                              />
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-slate-300">
                              {leadScore.explanation}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {leadScore &&
                      scoreBreakdownEntries(leadScore.breakdown).length > 0 && (
                        <section>
                          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                            Score breakdown
                          </h3>
                          <div className="space-y-1.5">
                            {scoreBreakdownEntries(leadScore.breakdown).map(
                              ([label, points]) => (
                                <div
                                  key={label}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/30 px-3 py-2"
                                >
                                  <span className="text-xs text-slate-300 capitalize">
                                    {label.replaceAll('_', ' ')}
                                  </span>
                                  {displayValue(points) && (
                                    <span className="text-primary text-xs font-semibold">
                                      {typeof points === 'number' && points > 0
                                        ? '+'
                                        : ''}
                                      {displayValue(points)}
                                    </span>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        </section>
                      )}

                    {leadRequirement && (
                      <section>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                            Captured requirements
                          </h3>
                          <span className="text-[10px] text-slate-600">
                            Updated{' '}
                            {new Date(
                              leadRequirement.updated_at
                            ).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {requirementFields.map((field) => {
                            const value = displayValue(
                              field.value(leadRequirement)
                            );
                            if (!value) return null;
                            return (
                              <div
                                key={field.label}
                                className="rounded-lg border border-slate-800 bg-slate-800/30 p-2.5"
                              >
                                <p className="text-[10px] tracking-wide text-slate-500 uppercase">
                                  {field.label}
                                </p>
                                <p className="mt-1 text-xs text-slate-200 capitalize">
                                  {value}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent
                value="tags"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Click a tag to add or remove it from this contact.
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No tags available. Create tags in Settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                              selected
                                ? 'ring-primary ring-2 ring-offset-1 ring-offset-slate-900'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="mr-1 size-3" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent
                value="notes"
                className="flex min-h-0 flex-1 flex-col px-4 py-3"
              >
                <div className="mb-3 space-y-2">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Write a note..."
                    className="min-h-[60px] resize-none border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Add Note
                  </Button>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-slate-500" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No notes yet.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="group rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-sm whitespace-pre-wrap text-slate-300">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="shrink-0 cursor-pointer text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500">
                          {new Date(note.created_at).toLocaleDateString(
                            'en-US',
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            }
                          )}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent
                value="custom"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-slate-500" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No custom fields defined. Create them in Settings.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-xs text-slate-400 capitalize">
                          {field.field_name}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Enter ${field.field_name}...`}
                          className="h-8 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Save Custom Fields
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent
                value="deals"
                className="flex-1 overflow-y-auto px-4 py-3"
              >
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="text-primary size-5 animate-spin" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-slate-500">No deals yet</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: deal.currency || 'USD',
                              maximumFractionDigits: 0,
                            }).format(Number(deal.value || 0))}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
