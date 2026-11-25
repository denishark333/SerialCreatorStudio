import { confirmAction } from './ConfirmDialog';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Link2, List, Plus } from 'lucide-react';
import {
  createSerialApi,
  type ApiChannel,
  type ApiPlan,
  type ApiPlanInput,
  type ApiPlanRecord,
  type ApiPlanStage,
} from './api';
import { apiSession } from './apiSession';
import {
  apiBase,
  channels as listChannels,
  dateToday,
  daysAgo,
  studioRequest,
  type Financial,
  type Page,
  type Video,
} from './studioApi';
import { addMonths, date, grid, monthStart, weekdayAudience } from './planner/calendar';
import { PlanDialog, type PlanDraft } from './planner/PlanDialog';
import { PlanDrawer } from './planner/PlanDrawer';
import { planFromRecord, RecordDrawer } from './planner/RecordDrawer';
import { PlannerCalendar, PlannerList, PlannerPipeline, type PlanDrag } from './planner/PlannerViews';

/** The editable fields of a plan (the API rejects anything else). */
const draftOf = (plan: ApiPlan): PlanDraft => ({
  id: plan.id,
  title: plan.title,
  channelId: plan.channelId,
  format: plan.format,
  date: plan.date,
  stage: plan.stage,
  time: plan.time ?? null,
  notes: plan.notes ?? '',
  ...(plan.format === 'Live' ? { channelIds: plan.channelIds?.length ? plan.channelIds : [plan.channelId] } : {}),
});

/**
 * Planejamento: monthly calendar, list and stage pipeline of planned content.
 * Global: one calendar for every connected platform (whatever the sidebar carousel shows), so a live and a video
 * planned for the same time are seen together; a live can go to several platforms at once (multistream).
 * Cards are dragged to another day (calendar) or stage (pipeline); a card opens its detail panel, where the plan
 * advances stage by stage up to "Publicar".
 */
export function StudioPlanner() {
  const [channels, setChannels] = useState<ApiChannel[]>([]),
    [channelsLoaded, setChannelsLoaded] = useState(false),
    [month, setMonth] = useState(() => monthStart(dateToday())),
    [tab, setTab] = useState('calendar'),
    [view, setView] = useState('calendar'),
    [plans, setPlans] = useState<ApiPlan[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [revision, setRevision] = useState(0),
    [draft, setDraft] = useState<PlanDraft | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedRecord, setSelectedRecord] = useState<ApiPlanRecord | null>(null),
    [dragging, setDragging] = useState<ApiPlan | null>(null),
    [audience, setAudience] = useState<number[] | null>(null),
    [deals, setDeals] = useState<Financial[]>([]),
    [records, setRecords] = useState<ApiPlanRecord[]>([]);
  const days = grid(month),
    from = days[0],
    to = days[41];
  const channelIds = channels.map(c => c.id),
    channelKey = channelIds.join(',');
  const api = () => createSerialApi(apiBase, () => apiSession.token);
  useEffect(() => {
    const refresh = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', refresh);
    return () => removeEventListener('serial-data-updated', refresh);
  }, []);
  // Channels of every platform (not only the one picked in the sidebar).
  useEffect(() => {
    let active = true;
    listChannels()
      .then(list => active && setChannels(list))
      .catch(e => active && setError((e as Error).message))
      .finally(() => active && setChannelsLoaded(true));
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    if (!channels.length) {
      setPlans([]);
      setLoading(!channelsLoaded);
      return;
    }
    setError('');
    setLoading(true);
    const query = { from, to, channelId: channelIds, limit: 100 };
    (async () => {
      try {
        const first = await api().plans(apiSession.workspaceId, query);
        const all = [...first.data];
        for (let page = 2; page <= first.pagination.totalPages; page++) {
          if (!active) return;
          all.push(...(await api().plans(apiSession.workspaceId, { ...query, page })).data);
        }
        if (active) setPlans(all);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [from, to, revision, channelKey, channelsLoaded]);
  // Published content / detected lives no plan claims (refetched when a plan's link changes).
  const linkKey = plans.map(p => p.id + ':' + (p.content?.id ?? '')).join(',');
  useEffect(() => {
    let active = true;
    if (!channels.length) {
      setRecords([]);
      return;
    }
    studioRequest<ApiPlanRecord[]>('plans/records', { params: { from, to, channelId: channelIds } })
      .then(list => active && setRecords(list ?? []))
      .catch(() => active && setRecords([]));
    return () => {
      active = false;
    };
  }, [from, to, revision, channelKey, linkKey]);
  // Audience by weekday (last 90 days of daily views) lights the calendar columns while a card is dragged, and the
  // brand deals offered in the detail panel. Both are optional: failures just leave them out.
  useEffect(() => {
    let active = true;
    setAudience(null);
    setDeals([]);
    if (!channels.length) return;
    const today = dateToday();
    api()
      .analytics(apiSession.workspaceId, { from: daysAgo(today, 90), to: today, channelId: channelIds })
      .then(r => {
        // Live reports only carry YouTube daily views; demo/merged studios also have Twitch and Kick.
        const rows = (r.data.timeseries ?? []).map(row => {
          const daily = row as { date: string; YouTube?: number; Twitch?: number; Kick?: number };
          return { date: daily.date, views: (daily.YouTube ?? 0) + (daily.Twitch ?? 0) + (daily.Kick ?? 0) };
        });
        if (active) setAudience(weekdayAudience(rows));
      })
      .catch(() => {});
    studioRequest<Page<Financial>>('financial/deals', {
      params: { history: 'all', channelId: channelIds, limit: 100 },
      list: true,
    })
      .then(r => active && setDeals(r.data ?? []))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [channelKey]);

  /** A plan for a confirmed brand deal: its title, channel and date, already linked to it. */
  function planDeal(deal: Financial) {
    setDraft({
      title: deal.title,
      channelId: channels.some(c => c.id === deal.channelId) ? deal.channelId : channels[0]?.id || '',
      format: 'Vídeo',
      date: deal.date,
      stage: 'Ideia',
      dealId: deal.id,
    });
  }
  function create(day = dateToday()) {
    setDraft({ title: '', channelId: channels[0]?.id || '', format: 'Vídeo', date: day, stage: 'Ideia' });
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const { id, ...body } = draft;
      if (id) {
        const updated = await api().updatePlan(apiSession.workspaceId, id, body);
        setPlans(current => current.map(p => (p.id === id ? updated.data : p)));
      } else await api().createPlan(apiSession.workspaceId, body);
      setDraft(null);
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  /** Optimistic partial update: the card moves at once and comes back if the API refuses the change. */
  async function patch(plan: ApiPlan, body: Partial<ApiPlanInput>) {
    setError('');
    setSaving(true);
    setPlans(current => current.map(p => (p.id === plan.id ? { ...p, ...body } : p)));
    try {
      const updated = await api().updatePlan(apiSession.workspaceId, plan.id, body);
      setPlans(current => current.map(p => (p.id === plan.id ? { ...p, ...updated.data } : p)));
      return true;
    } catch (e) {
      setPlans(current => current.map(p => (p.id === plan.id ? plan : p)));
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function remove(plan: ApiPlan) {
    const confirmed = await confirmAction({
      title: 'Remover este plano?',
      message: `“${plan.title}” será removido do planejamento. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Remover',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api().deletePlan(apiSession.workspaceId, plan.id);
      setSelectedId(null);
      setPlans(current => current.filter(p => p.id !== plan.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const draggingRef = useRef<ApiPlan | null>(null);
  const drag: PlanDrag = {
    dragging,
    current: () => draggingRef.current,
    onDragStart: plan => {
      draggingRef.current = plan;
      setDragging(plan);
    },
    onDragEnd: () => {
      draggingRef.current = null;
      setDragging(null);
    },
  };
  const dropOnDay = (plan: ApiPlan, day: string) => {
    drag.onDragEnd();
    if (plan.date !== day) void patch(plan, { date: day });
  };
  const dropOnStage = (plan: ApiPlan, stage: ApiPlanStage) => {
    drag.onDragEnd();
    if (plan.stage !== stage) void patch(plan, { stage });
  };
  const loadVideos = async (ids: string[]) =>
    (await studioRequest<Page<Video>>('catalog', { params: { channelId: ids, sort: 'date', limit: 30 }, list: true }))
      .data;

  const ordered = [...plans].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title),
  );
  const inMonth = ordered.filter(p => p.date.slice(0, 7) === month.slice(0, 7));
  const selected = plans.find(p => p.id === selectedId) ?? null;
  const open = (plan: ApiPlan) => setSelectedId(plan.id);
  /** Turns a record into a plan (published, linked to its content) and opens the plan's panel. */
  async function addRecord(record: ApiPlanRecord) {
    setSaving(true);
    setError('');
    try {
      const created = await api().createPlan(apiSession.workspaceId, planFromRecord(record));
      setSelectedRecord(null);
      if (created.data?.id && created.data.date) {
        setPlans(current => [...current, created.data]);
        setSelectedId(created.data.id);
      }
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="studio-planner">
      <div className="planner-heading">
        <div className="planner-month">
          <button className="icon" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={17} />
          </button>
          <h2>{new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date(month))}</h2>
          <button className="icon" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={17} />
          </button>
          <button onClick={() => setMonth(monthStart(dateToday()))}>Hoje</button>
        </div>
        <div className="planner-heading-actions">
          {tab === 'calendar' && (
            <div className="segmented">
              <button className={view === 'calendar' ? 'selected' : ''} onClick={() => setView('calendar')}>
                <CalendarDays size={14} />
                Calendário
              </button>
              <button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>
                <List size={14} />
                Lista
              </button>
            </div>
          )}
          <button
            className="primary"
            disabled={!channels.length}
            onClick={() => create(month.slice(0, 7) === dateToday().slice(0, 7) ? dateToday() : month)}
          >
            <Plus size={16} />
            Planejar conteúdo
          </button>
        </div>
      </div>
      <div className="tabs studio-tabs">
        <button className={tab === 'calendar' ? 'selected' : ''} onClick={() => setTab('calendar')}>
          Calendário
        </button>
        <button className={tab === 'pipeline' ? 'selected' : ''} onClick={() => setTab('pipeline')}>
          Pipeline <span>{inMonth.length}</span>
        </button>
      </div>
      {error && !selected && !draft && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <div className="planner-status" role="status">
        {loading
          ? 'Atualizando planejamento…'
          : `${inMonth.length} ${inMonth.length === 1 ? 'conteúdo planejado' : 'conteúdos planejados'} neste mês · todas as plataformas`}
      </div>
      {channelsLoaded && !channels.length ? (
        <section className="panel empty">
          <Link2 size={30} />
          <h2>Conecte uma plataforma</h2>
          <p>O planejamento reúne os canais de todas as plataformas conectadas.</p>
          <a href="#/settings" className="primary">
            Abrir conexões <ArrowRight size={15} />
          </a>
        </section>
      ) : tab === 'calendar' && view === 'calendar' ? (
        <PlannerCalendar
          days={days}
          month={month}
          plans={ordered}
          channels={channels}
          onOpen={open}
          onCreate={create}
          drag={drag}
          audience={audience}
          onMoveDate={dropOnDay}
          deals={deals.filter(
            d =>
              d.stage === 'Confirmado' &&
              !plans.some(p => p.dealId === d.id) &&
              !records.some(r => r.deal?.id === d.id),
          )}
          records={records.filter(r => !plans.some(p => p.content?.id === r.id))}
          onOpenRecord={setSelectedRecord}
          onPlanDeal={planDeal}
        />
      ) : tab === 'pipeline' ? (
        <PlannerPipeline plans={inMonth} channels={channels} onOpen={open} drag={drag} onMoveStage={dropOnStage} />
      ) : (
        <PlannerList plans={inMonth} channels={channels} onOpen={open} />
      )}
      <RecordDrawer
        record={draft ? null : selectedRecord}
        channels={channels}
        saving={saving}
        error={error}
        onAdd={record => void addRecord(record)}
        onClose={() => setSelectedRecord(null)}
      />
      <PlanDrawer
        plan={draft ? null : selected}
        channels={channels}
        deals={deals}
        saving={saving}
        error={error}
        onPatch={patch}
        onEdit={plan => setDraft(draftOf(plan))}
        onRemove={plan => void remove(plan)}
        onClose={() => setSelectedId(null)}
        loadVideos={loadVideos}
        plans={plans}
      />
      <PlanDialog
        draft={draft}
        dealTitle={draft?.dealId ? deals.find(d => d.id === draft.dealId)?.title : undefined}
        channels={channels}
        plans={plans}
        saving={saving}
        error={error}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={() => void save()}
        onRemove={() => {
          const plan = plans.find(p => p.id === draft?.id);
          if (plan) {
            setDraft(null);
            void remove(plan);
          }
        }}
      />
    </section>
  );
}
