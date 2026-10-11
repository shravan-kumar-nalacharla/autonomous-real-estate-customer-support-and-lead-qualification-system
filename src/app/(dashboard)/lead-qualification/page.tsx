'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Flame,
  Loader2,
  Search,
  Snowflake,
  Sparkles,
  ThermometerSun,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

type LeadCategory = 'hot' | 'warm' | 'cold' | 'general_enquiry';

interface LeadRow {
  id: string;
  contact_id: string;
  score: number;
  category: LeadCategory;
  explanation: string;
  updated_at: string;
  contact?: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    company: string | null;
  };
}

const filters: Array<{ value: 'all' | LeadCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
  { value: 'general_enquiry', label: 'General enquiry' },
];

function categoryClasses(category: LeadCategory) {
  if (category === 'hot') return 'border-red-500/20 bg-red-500/10 text-red-400';
  if (category === 'warm')
    return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
  if (category === 'cold')
    return 'border-sky-500/20 bg-sky-500/10 text-sky-400';
  return 'border-slate-600 bg-slate-700/40 text-slate-300';
}

export default function LeadQualificationPage() {
  const supabase = useMemo(() => createClient(), []);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | LeadCategory>('all');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  );

  async function loadLeads() {
    setLoading(true);
    const scoresResult = await supabase
      .from('lead_scores')
      .select('id, contact_id, score, category, explanation, updated_at')
      .order('score', { ascending: false });

    if (scoresResult.error) {
      toast.error('Failed to load lead qualification');
      setLoading(false);
      return;
    }

    const scores = (scoresResult.data ?? []) as Omit<LeadRow, 'contact'>[];
    const contactIds = scores.map((lead) => lead.contact_id);
    if (contactIds.length === 0) {
      setLeads([]);
      setLoading(false);
      return;
    }

    const contactsResult = await supabase
      .from('contacts')
      .select('id, name, phone, email, company')
      .in('id', contactIds);

    if (contactsResult.error) {
      toast.error('Failed to load qualified customers');
      setLoading(false);
      return;
    }

    const contacts = new Map(
      (contactsResult.data ?? []).map((contact) => [contact.id, contact])
    );
    setLeads(
      scores.map((lead) => ({
        ...lead,
        contact: contacts.get(lead.contact_id),
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    void loadLeads();
    // The Supabase browser client is stable for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleLeads = leads.filter((lead) => {
    if (category !== 'all' && lead.category !== category) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [lead.contact?.name, lead.contact?.phone, lead.contact?.email]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(term));
  });

  const hotCount = leads.filter((lead) => lead.category === 'hot').length;
  const warmCount = leads.filter((lead) => lead.category === 'warm').length;
  const averageScore = leads.length
    ? Math.round(
        leads.reduce((total, lead) => total + lead.score, 0) / leads.length
      )
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Qualification</h1>
          <p className="mt-1 text-sm text-slate-400">
            Prioritize customers by qualification score and captured intent.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search qualified customers"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <Users className="mb-3 h-5 w-5 text-slate-400" />
          <p className="text-2xl font-bold text-white">{leads.length}</p>
          <p className="text-xs text-slate-500">Qualified customers</p>
        </div>
        <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-4">
          <Flame className="mb-3 h-5 w-5 text-red-400" />
          <p className="text-2xl font-bold text-white">{hotCount}</p>
          <p className="text-xs text-slate-500">Hot leads</p>
        </div>
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4">
          <ThermometerSun className="mb-3 h-5 w-5 text-amber-400" />
          <p className="text-2xl font-bold text-white">{warmCount}</p>
          <p className="text-xs text-slate-500">Warm leads</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <Sparkles className="mb-3 h-5 w-5 text-orange-400" />
          <p className="text-2xl font-bold text-white">{averageScore}</p>
          <p className="text-xs text-slate-500">Average score</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setCategory(filter.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              category === filter.value
                ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-44 items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading qualification profiles
        </div>
      ) : visibleLeads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <Snowflake className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <p className="text-sm font-medium text-slate-300">
            No matching lead profiles
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Qualified customers will appear here with their score and category.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleLeads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => setSelectedContactId(lead.contact_id)}
              className="group rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900/70"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-orange-500/40 bg-orange-500/10 text-lg font-bold text-white">
                  {lead.score}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold text-white">
                      {lead.contact?.name ||
                        lead.contact?.phone ||
                        'Unknown customer'}
                    </h2>
                    <Badge
                      className={`capitalize ${categoryClasses(lead.category)}`}
                    >
                      {lead.category.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {lead.contact?.phone}
                    {lead.contact?.company ? ` · ${lead.contact.company}` : ''}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-300">
                    {lead.explanation}
                  </p>
                  <p className="mt-3 text-[11px] text-slate-600">
                    Updated{' '}
                    {new Date(lead.updated_at).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" />
              </div>
            </button>
          ))}
        </div>
      )}

      <ContactDetailView
        open={Boolean(selectedContactId)}
        onOpenChange={(open) => {
          if (!open) setSelectedContactId(null);
        }}
        contactId={selectedContactId}
        onUpdated={loadLeads}
      />
    </div>
  );
}
