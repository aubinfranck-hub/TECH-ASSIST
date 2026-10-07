import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminOverview } from '../components/AdminOverview.js';
import { AdminLearningPanel } from '../components/AdminLearningPanel.js';
import { AdminPartnersPanel } from '../components/AdminPartnersPanel.js';
import { CreateCompanyForm } from '../components/CreateCompanyForm.js';
import { TechnicianLoginForm } from '../components/TechnicianLoginForm.js';
import { api, ApiError, type PricingPlan } from '../lib/api.js';

type View = 'overview' | 'crm' | 'companies' | 'technicians' | 'billing' | 'ai' | 'audit';

interface Company { id:string; name:string; phone:string; subscription_status:string; plan_name:string|null; assigned_technician_name:string|null; created_at:string; }
interface Application { id:string; full_name:string; phone:string; skills:string|null; status:string; created_at:string; }
interface PmeRequest { id:string; company_name:string; contact_name:string; phone:string; computers_count:number|null; status:string; created_at:string; }
interface AuditLog { id:string; actor_type:string; action:string; created_at:string; }

const nav: {id:View; label:string; icon:string}[] = [
  {id:'overview',label:'Vue d’ensemble',icon:'▦'},
  {id:'crm',label:'CRM & prospects',icon:'◉'},
  {id:'companies',label:'Entreprises',icon:'▣'},
  {id:'technicians',label:'Techniciens',icon:'♙'},
  {id:'billing',label:'Facturation',icon:'₣'},
  {id:'ai',label:'IA & connaissances',icon:'✦'},
  {id:'audit',label:'Journal & sécurité',icon:'◌'},
];

function Status({value}:{value:string}) {
  const v=value.toLowerCase();
  const cls=v.includes('active')||v.includes('paid')||v.includes('approved')||v==='done'
    ? 'bg-emerald-50 text-emerald-700' : v.includes('pending')||v.includes('waiting')||v.includes('new')
    ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{value}</span>;
}

export function AdminPage() {
  const [token,setToken]=useState<string|null>(localStorage.getItem('tech_assist_token'));
  const [view,setView]=useState<View>('overview');
  const [plans,setPlans]=useState<PricingPlan[]>([]);
  const [applications,setApplications]=useState<Application[]>([]);
  const [pmeRequests,setPmeRequests]=useState<PmeRequest[]>([]);
  const [companies,setCompanies]=useState<Company[]>([]);
  const [auditLogs,setAuditLogs]=useState<AuditLog[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState('');

  const refresh=useCallback(async()=>{
    try {
      const [pricing,apps,pme,cs,logs]=await Promise.all([
        api.get<{plans:PricingPlan[]}>('/api/pricing'),
        api.get<{applications:Application[]}>('/api/admin/technician-applications'),
        api.get<{requests:PmeRequest[]}>('/api/admin/pme-requests'),
        api.get<{companies:Company[]}>('/api/admin/companies'),
        api.get<{logs:AuditLog[]}>('/api/admin/audit-logs'),
      ]);
      setPlans(pricing.plans); setApplications(apps.applications); setPmeRequests(pme.requests); setCompanies(cs.companies); setAuditLogs(logs.logs); setError(null);
    } catch(err) {
      if(err instanceof ApiError && err.status===401){localStorage.removeItem('tech_assist_token');setToken(null);}
      else setError(err instanceof ApiError && err.status===403 ? 'Ce compte n’a pas les droits administrateur.' : 'Impossible de charger les données SaaS.');
    }
  },[]);
  useEffect(()=>{if(token) void refresh();},[token,refresh]);

  function login(t:string){localStorage.setItem('tech_assist_token',t);setToken(t);}
  async function updatePlan(plan:PricingPlan,price:number){
    await api.put(`/api/admin/pricing/${plan.id}`,{name:plan.name,segment:plan.segment,priceFcfa:price,durationMinutes:plan.duration_minutes??undefined,description:plan.description,active:true,sortOrder:0});
    void refresh();
  }

  const filteredCompanies=useMemo(()=>companies.filter(c=>[c.name,c.phone,c.plan_name??'',c.subscription_status].join(' ').toLowerCase().includes(search.toLowerCase())),[companies,search]);
  const activeCompanies=companies.filter(c=>c.subscription_status==='active').length;
  const openLeads=pmeRequests.filter(r=>!['converted','closed','rejected'].includes(r.status)).length;

  if(!token) return <div className="ta-container flex min-h-[78vh] max-w-md items-center py-14"><div className="ta-card w-full p-8 shadow-xl"><p className="ta-eyebrow">TECHASSIST OS</p><h1 className="mt-2 font-display text-3xl font-black">Console d’administration</h1><p className="mt-2 mb-6 text-sm leading-6 text-slate-600">Pilotez le support, le CRM, les entreprises et les opérations depuis un seul espace.</p><TechnicianLoginForm onLoggedIn={login}/></div></div>;

  return <div className="min-h-[calc(100vh-72px)] bg-slate-50">
    <div className="flex min-h-[calc(100vh-72px)]">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-0 p-5">
          <div className="mb-7 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[.18em] text-brand-400">TECHASSIST OS</p><p className="mt-2 text-xl font-black">Operations</p><p className="mt-1 text-xs text-slate-400">Centre de contrôle SaaS</p></div>
          <nav className="space-y-1">{nav.map(n=><button key={n.id} onClick={()=>setView(n.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${view===n.id?'bg-brand-50 text-brand-700':'text-slate-600 hover:bg-slate-50'}`}><span className="w-5 text-center">{n.icon}</span>{n.label}</button>)}</nav>
          <button onClick={()=>{localStorage.removeItem('tech_assist_token');setToken(null);}} className="mt-8 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600">Déconnexion</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 sm:px-8 lg:px-10">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div><p className="text-xs font-black uppercase tracking-[.16em] text-brand-700">Administration</p><h1 className="font-display text-2xl font-black sm:text-3xl">{nav.find(n=>n.id===view)?.label}</h1></div>
              <div className="flex gap-2"><button onClick={()=>void refresh()} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold">Actualiser</button><a href="/technicien" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Console technicien →</a></div>
            </div>
            <div className="flex gap-1 overflow-x-auto lg:hidden">{nav.map(n=><button key={n.id} onClick={()=>setView(n.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${view===n.id?'bg-brand-600 text-white':'bg-slate-100 text-slate-600'}`}>{n.label}</button>)}</div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-7 px-5 py-7 sm:px-8 lg:px-10">
          {error&&<div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

          {view==='overview'&&<><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[['Entreprises',companies.length],['Abonnements actifs',activeCompanies],['Prospects ouverts',openLeads],['Candidatures',applications.length],['Journal',auditLogs.length]].map(([l,v])=><div key={String(l)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{l}</p><p className="mt-2 font-display text-3xl font-black">{v}</p><p className="mt-1 text-xs text-slate-400">données actuelles</p></div>)}
          </div><AdminOverview/></>}

          {view==='crm'&&<section className="space-y-5">
            <div className="rounded-[24px] bg-slate-950 p-6 text-white sm:p-8"><p className="text-xs font-black uppercase tracking-[.16em] text-brand-400">CRM</p><h2 className="mt-2 font-display text-3xl font-black">Prospects & opportunités</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Les demandes PME sont votre pipeline commercial. Qualifiez-les, convertissez-les en entreprise et suivez leur statut.</p></div>
            <div className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl bg-white p-5 border"><p className="text-xs text-slate-500">Nouveaux prospects</p><p className="mt-2 text-3xl font-black">{pmeRequests.filter(r=>r.status==='new').length}</p></div><div className="rounded-2xl bg-white p-5 border"><p className="text-xs text-slate-500">En cours</p><p className="mt-2 text-3xl font-black">{openLeads}</p></div><div className="rounded-2xl bg-white p-5 border"><p className="text-xs text-slate-500">Entreprises</p><p className="mt-2 text-3xl font-black">{companies.length}</p></div></div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b p-5"><h3 className="font-black">Pipeline commercial</h3></div><div className="divide-y">{pmeRequests.map(r=><div key={r.id} className="grid gap-3 p-5 sm:grid-cols-[1.5fr_1fr_auto_auto] sm:items-center"><div><p className="font-bold">{r.company_name}</p><p className="text-sm text-slate-500">{r.contact_name} · {r.phone}</p></div><p className="text-sm text-slate-500">{r.computers_count??'—'} postes</p><Status value={r.status}/><p className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString('fr-FR')}</p></div>)}{pmeRequests.length===0&&<p className="p-8 text-sm text-slate-500">Aucun prospect.</p>}</div></div>
          </section>}

          {view==='companies'&&<section className="space-y-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="ta-eyebrow">CRM CLIENTS</p><h2 className="mt-2 font-display text-3xl font-black">Entreprises clientes</h2></div><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une entreprise..." className="ta-input max-w-sm"/></div>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50"><tr>{['Entreprise','Contact','Formule','Technicien','Statut','Créée'].map(h=><th key={h} className="p-4 text-left text-xs font-black uppercase tracking-wider text-slate-500">{h}</th>)}</tr></thead><tbody>{filteredCompanies.map(c=><tr key={c.id} className="border-t hover:bg-slate-50"><td className="p-4 font-bold">{c.name}</td><td className="p-4">{c.phone}</td><td className="p-4">{c.plan_name??'—'}</td><td className="p-4">{c.assigned_technician_name??'Non assigné'}</td><td className="p-4"><Status value={c.subscription_status}/></td><td className="p-4 text-slate-500">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td></tr>)}</tbody></table></div><CreateCompanyForm pmePlans={plans.filter(p=>p.segment==='pme')} onCreated={refresh}/></section>}

          {view==='technicians'&&<section className="space-y-5"><div className="rounded-[24px] bg-slate-950 p-6 text-white"><p className="text-xs font-black uppercase tracking-[.16em] text-brand-400">RESSOURCES HUMAINES</p><h2 className="mt-2 font-display text-3xl font-black">Réseau technicien</h2><p className="mt-2 text-sm text-slate-400">Candidatures et capacité de support.</p></div><div className="overflow-hidden rounded-2xl border bg-white"><div className="divide-y">{applications.map(a=><div key={a.id} className="grid gap-3 p-5 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center"><div><p className="font-bold">{a.full_name}</p><p className="text-sm text-slate-500">{a.phone}</p></div><p className="text-sm text-slate-500">{a.skills??'Compétences non renseignées'}</p><Status value={a.status}/><p className="text-xs text-slate-400">{new Date(a.created_at).toLocaleDateString('fr-FR')}</p></div>)}{applications.length===0&&<p className="p-8 text-sm text-slate-500">Aucune candidature.</p>}</div></div><AdminPartnersPanel/></section>}

          {view==='billing'&&<section className="space-y-5"><div><p className="ta-eyebrow">REVENUS</p><h2 className="mt-2 font-display text-3xl font-black">Plans & facturation</h2><p className="mt-2 text-sm text-slate-600">Gestion des offres commerciales actuellement exposées par TechAssist.</p></div><div className="grid gap-4 md:grid-cols-3">{plans.map(p=><div key={p.id} className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">{p.segment}</p><h3 className="mt-2 font-black">{p.name}</h3><div className="mt-4 flex items-center gap-2"><input type="number" value={p.price_fcfa} onChange={e=>setPlans(prev=>prev.map(x=>x.id===p.id?{...x,price_fcfa:Number(e.target.value)}:x))} className="ta-input w-32"/><span className="text-sm font-bold">FCFA</span></div><button onClick={()=>void updatePlan(p,p.price_fcfa)} className="ta-button-primary mt-4 w-full">Enregistrer</button></div>)}</div></section>}

          {view==='ai'&&<section className="space-y-5"><div className="rounded-[24px] bg-gradient-to-br from-slate-950 to-slate-800 p-7 text-white"><p className="text-xs font-black uppercase tracking-[.16em] text-brand-400">AI OPERATIONS</p><h2 className="mt-2 font-display text-3xl font-black">Intelligence & apprentissage</h2><p className="mt-2 text-sm leading-6 text-slate-400">Supervisez les connaissances apprises, les procédures et les limites d’intervention de l’assistant.</p></div><AdminLearningPanel/></section>}

          {view==='audit'&&<section className="space-y-5"><div><p className="ta-eyebrow">CONFORMITÉ</p><h2 className="mt-2 font-display text-3xl font-black">Journal & sécurité</h2></div><div className="overflow-hidden rounded-2xl border bg-white"><div className="max-h-[650px] overflow-auto divide-y">{auditLogs.map(l=><div key={l.id} className="grid gap-2 p-4 sm:grid-cols-[180px_100px_1fr]"><span className="text-xs text-slate-400">{new Date(l.created_at).toLocaleString('fr-FR')}</span><Status value={l.actor_type}/><span className="font-mono text-xs text-slate-600">{l.action}</span></div>)}{auditLogs.length===0&&<p className="p-8 text-sm text-slate-500">Aucune entrée d’audit.</p>}</div></div></section>}
        </div>
      </main>
    </div>
  </div>;
}
