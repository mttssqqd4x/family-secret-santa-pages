import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Gift, Heart, LockKeyhole, LogOut, Settings2, Sparkles, ArrowLeft, RefreshCw } from 'lucide-react';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && key && /^https:\/\//.test(url));
const sb = configured ? createClient(url, key) : null;
const year = () => Number(new Intl.DateTimeFormat('en-US', {timeZone:'America/Denver',year:'numeric'}).format(new Date()));
const knownNames = ['Joe','Dawn','Katie','Sam','Jordyn','Jonah'];
function errText(err) {return err?.message || 'Something went wrong. Please try again.'}
function check({error}) {if (error) throw error;}
const nameOf = (members,id) => members.find(m=>m.id===id)?.display_name || 'Former member';
function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [page,setPage] = useState('home');
  const [me,setMe] = useState(null);
  const [pair,setPair] = useState(null);
  const [myList,setMyList] = useState('');
  const [theirList,setTheirList] = useState('');
  const [addOnly,setAddOnly] = useState(false);
  const [members,setMembers] = useState([]);
  const [exclusions,setExclusions] = useState([]);
  const [history,setHistory] = useState([]);
  const [pairCount,setPairCount] = useState(0);
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [authMode,setAuthMode] = useState('login');
  const [wishlistDraft,setWishlistDraft] = useState('');
  const [addition,setAddition] = useState('');
  const [giver,setGiver] = useState('');
  const [recipient,setRecipient] = useState('');
  const [confirmed,setConfirmed] = useState(false);

  useEffect(()=>{
    if (!sb) {setReady(true); return;}
    sb.auth.getSession().then(({data,error})=>{if(error) setNotice(errText(error));setSession(data?.session||null);setReady(true)});
    const {data:{subscription}} = sb.auth.onAuthStateChange((_event,newSession)=>{setSession(newSession);setPage('home')});
    return ()=>subscription.unsubscribe();
  },[]);

  const refresh = useCallback(async () => {
    if (!sb || !session?.user) return;
    try {
      const {data:profile,error:pe} = await sb.from('profiles').select('id,display_name,approved,is_admin').eq('id',session.user.id).single();
      check({error:pe}); setMe(profile);
      if (!profile.approved) {setPair(null);return;}
      const [listRes, modeRes, pairRes] = await Promise.all([
        sb.from('wishlists').select('content').eq('user_id',session.user.id).maybeSingle(),
        sb.rpc('wishlist_add_only_now'),
        sb.from('assignments').select('recipient_id').eq('giver_id',session.user.id).eq('year',year()).maybeSingle()
      ]);
      check(listRes);check(modeRes);check(pairRes);
      const list = listRes.data?.content||'';
      setMyList(list);setWishlistDraft(list);setAddOnly(modeRes.data===true);
      if(pairRes.data?.recipient_id) {
        const [personRes, giftRes] = await Promise.all([
          sb.from('profiles').select('id,display_name').eq('id',pairRes.data.recipient_id).single(),
          sb.from('wishlists').select('content').eq('user_id',pairRes.data.recipient_id).maybeSingle()
        ]);
        check(personRes);check(giftRes);setPair(personRes.data);setTheirList(giftRes.data?.content||'');
      } else {setPair(null);setTheirList('');}
    } catch(e) {setNotice(errText(e));}
  },[session?.user?.id]);

  const refreshAdmin = useCallback(async () => {
    if (!sb || !session?.user || !me?.is_admin) return;
    try {
      const [m,e,h,c] = await Promise.all([
        sb.from('profiles').select('id,display_name,approved,is_admin').order('display_name'),
        sb.from('exclusions').select('id,giver_id,recipient_id').order('id'),
        sb.from('historical_assignments').select('year,giver_name,recipient_name').order('year',{ascending:false}).order('giver_name'),
        sb.rpc('assignment_count')
      ]);
      for(const result of [m,e,h,c]) check(result);
      setMembers(m.data||[]);setExclusions(e.data||[]);setHistory(h.data||[]);setPairCount(c.data||0);
    } catch(e) {setNotice(errText(e));}
  },[session?.user?.id,me?.is_admin]);
  useEffect(()=>{refresh()},[refresh]);
  useEffect(()=>{if(page==='admin') refreshAdmin()},[page,refreshAdmin]);

  const run = async (operation, success, refreshAdminToo=false) => {
    setBusy(true);setNotice('');
    try {await operation();setNotice(success);await refresh();if(refreshAdminToo) await refreshAdmin();}
    catch(e) {setNotice('Error: '+errText(e))}
    finally {setBusy(false)}
  };
  const signOut = () => run(async()=>check(await sb.auth.signOut()),'You have signed out.');
  const submitAuth = async (event) => {
    event.preventDefault();const form = new FormData(event.currentTarget);
    const email = String(form.get('email')||'').trim();const password = String(form.get('password')||'');
    if(authMode==='signup' && !knownNames.includes(String(form.get('name')||''))) {setNotice('Select your name from the family list.');return;}
    await run(async()=>{
      if(authMode==='signup') {
        const response=await sb.auth.signUp({email,password,options:{data:{full_name:String(form.get('name'))},emailRedirectTo:window.location.origin + import.meta.env.BASE_URL}});
        check(response);
      } else check(await sb.auth.signInWithPassword({email,password}));
    },authMode==='signup'?'Account created. Confirm your email, then sign in.':'Signed in.');
  };
  const saveList = async e => {e.preventDefault(); await run(async()=>{
      const {error} = await sb.from('wishlists').upsert({user_id:session.user.id,content:wishlistDraft,updated_at:new Date().toISOString()},{onConflict:'user_id'}); if(error) throw error;
    },'Wish list saved!');};
  const append = async e => {e.preventDefault();await run(async()=>check(await sb.rpc('append_wishlist',{addition:addition.trim()})),'New wishes added!');setAddition('')};
  const approve = (id, approved) => run(async()=>check(await sb.from('profiles').update({approved}).eq('id',id)),approved?'Member approved.':'Member removed from approved family.',true);
  const addRule = async e => {e.preventDefault();if(!giver||!recipient||giver===recipient){setNotice('Choose two different people.');return;}await run(async()=>check(await sb.from('exclusions').insert({giver_id:giver,recipient_id:recipient})),'Restriction added.',true);setGiver('');setRecipient('')};
  const removeRule = id => run(async()=>check(await sb.from('exclusions').delete().eq('id',id)),'Restriction removed.',true);
  const draw = async e => {e.preventDefault();if(!confirmed)return;await run(async()=>check(await sb.rpc('draw_secret_santa')),'Names have been drawn for '+year()+'!',true);setConfirmed(false)};
  const homeButton = <button className="navlink" onClick={()=>{setNotice('');setPage('home')}}><ArrowLeft size={16}/> My page</button>;
  const header = <header className="topbar"><div className="brand"><span className="brandmark" aria-hidden="true"><Sparkles size={22} strokeWidth={2.2}/></span><span>Secret Santa <small>FAMILY EDITION</small></span></div><nav className="nav">{page==='admin'?homeButton:<>{me?.is_admin&&<button className="navlink" onClick={()=>{setNotice('');setPage('admin')}}><Settings2 size={16}/> Organizer</button>}<button className="navlink" onClick={()=>refresh()}><RefreshCw size={15}/> Refresh</button></>}<button className="navlink" disabled={busy} onClick={signOut}><LogOut size={16}/> Sign out</button></nav></header>;
  if (!configured) return <main className="authwrap"><div className="authcard"><h1>Setup needed</h1><p>This site needs the Supabase project URL and publishable key configured in the GitHub repository variables. See README.md.</p></div></main>;
  if(!ready) return <main className="authwrap"><div className="authcard">Loading Christmas magic…</div></main>;
  if(!session) return <div className="authwrap"><section className="authcard"><div className="authsparkle">✳</div><div className="eyebrow"><Sparkles size={14}/> FAMILY CHRISTMAS</div><h1>{authMode==='login'?'Welcome ': 'Join the '}<em>{authMode==='login'?'back!':'family'}</em></h1><p className="lede">{authMode==='login'?'Sign in to see your Secret Santa and their wishes.':'Create your account to join the family drawing.'}</p>{notice&&<p className={'flash '+(notice.startsWith('Error:')?'bad':'')}>{notice}</p>}<form className="stack" onSubmit={submitAuth}>{authMode==='signup'&&<label>Your name<select name="name" required defaultValue=""><option value="" disabled>Choose your name</option>{knownNames.map(n=><option key={n} value={n}>{n}</option>)}</select></label>}<label>Email<input name="email" type="email" autoComplete="email" required/></label><label>Password<input name="password" type="password" autoComplete={authMode==='login'?'current-password':'new-password'} minLength={8} required/></label><button disabled={busy} className="primary wide" type="submit">{busy?'Working…':authMode==='login'?'Sign in':'Create account'}</button></form><p className="authfoot">{authMode==='login'?'New to the family site? ':'Already signed up? '}<button className="textbutton" onClick={()=>{setAuthMode(authMode==='login'?'signup':'login');setNotice('')}}>{authMode==='login'?'Create an account':'Sign in'}</button></p></section></div>;
  if(page==='admin' && me?.is_admin) return <div className="site">{header}<main className="container admin"><div className="eyebrow"><Settings2 size={16}/> FAMILY ORGANIZER</div><h1>Santa's <em>workshop</em></h1><p className="lede">Approve family members, set restrictions, and draw names.</p>{notice&&<p role="status" className={'flash '+(notice.startsWith('Error:')?'bad':'')}>{notice}</p>}
    <section className="panel"><h2>1. Family members <span className="count">{members.filter(m=>m.approved).length} approved</span></h2><p>Approve only relatives you recognize. The drawing includes all approved accounts.</p><div className="memberlist">{members.map(m=><div className="member" key={m.id}><div><strong>{m.display_name}</strong>{m.is_admin&&<span className="pill">Organizer</span>}<div className="muted small">{m.approved?'Approved':'Waiting for approval'}</div></div><button disabled={busy||m.id===session.user.id} onClick={()=>approve(m.id,!m.approved)} className="outline">{m.approved?'Remove':'Approve'}</button></div>)}</div></section>
    <section className="panel"><h2>2. Drawing restrictions</h2><p>Add permanent directional restrictions. Previous-year pairs are automatically blocked as well.</p><form className="ruleform" onSubmit={addRule}><label>Person<select value={giver} onChange={e=>setGiver(e.target.value)} required><option value="">Select person</option>{members.filter(m=>m.approved).map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><label>Cannot buy for<select value={recipient} onChange={e=>setRecipient(e.target.value)} required><option value="">Select person</option>{members.filter(m=>m.approved).map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><button disabled={busy} className="primary">Add rule</button></form><div className="rulelist">{exclusions.map(e=><div className="rule" key={e.id}><span>{nameOf(members,e.giver_id)} <b>cannot draw</b> {nameOf(members,e.recipient_id)}</span><button disabled={busy} className="textbutton" onClick={()=>removeRule(e.id)}>Remove</button></div>)}</div></section>
    <section className="panel"><h2>3. Draw {year()} names</h2><p><strong>{pairCount}</strong> assignments are saved for this year. Redrawing changes this year's assignments only, and will change what members see.</p><form className="drawform" onSubmit={draw}><label className="checkboxline"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/> I understand this creates or replaces the current year's assignments.</label><button className="primary" disabled={busy||members.filter(m=>m.approved).length<2||!confirmed}>{busy?'Working…':pairCount?'🎁 Redraw assignments':'🎁 Draw Secret Santa names'}</button></form><p className="muted small">Past drawings are saved. Organizer sees this year's count, not everyone's secret assignments.</p></section>
    <section className="panel"><h2>4. Previous Christmas drawings</h2><p>Historical pairings are visible only to the organizer. No drawing took place in 2023.</p>{[...new Set([2025,2024,2023,2022,...history.map(h=>h.year)])].sort((a,b)=>b-a).map(y=><div key={y} style={{marginTop:18}}><h3>{y}</h3>{y===2023?<p className="muted small">No drawing — Jonah and Katie spent Christmas with Jonah’s family.</p>:<div className="rulelist">{history.filter(h=>h.year===y).map(h=><div className="rule" key={y+h.giver_name}><span><strong>{h.giver_name}</strong> had {h.recipient_name}</span></div>)}</div>}</div>)}</section>
  </main></div>;
  return <div className="site">{header}<main className="container"><div className="eyebrow"><Sparkles size={15}/> A LITTLE CHRISTMAS MAGIC</div><h1>Merry Christmas, <em>{me?.display_name||'friend'}!</em></h1><p className="lede">Your family's cozy corner of Christmas.</p>{notice&&<p role="status" className={'flash '+(notice.startsWith('Error:')?'bad':'')}>{notice}</p>}{!me?.approved?<section className="panel center"><LockKeyhole size={32}/><h2>You're on the nice list... almost!</h2><p>Your account is waiting for the family organizer to approve it.</p></section>:<div className="cards"><section className="panel reveal"><div className="sectionhead"><span className="iconcircle"><Gift size={22}/></span><span className="tag">YOUR SECRET ASSIGNMENT</span></div><div className="subtle">This year, you're shopping for</div><h2 className="recipient">{pair?.display_name||"It's still a secret…"}</h2><p>{pair?'Keep it a surprise! Only you can see this assignment.':"The organizer hasn't drawn names yet. Check back soon!"}</p><div className="divider"/><h3><Heart size={18}/> Their wish list</h3>{pair?<div className="wishlistText">{theirList.trim()||"They haven't added a wish list yet. Check back later!"}</div>:<p className="muted">Their list will appear here after the drawing.</p>}</section><section className="panel"><div className="sectionhead"><span className="iconcircle berry"><Heart size={22}/></span><span className="tag">YOUR CHRISTMAS WISHES</span></div><h2>My wish list</h2><p>Gift ideas, sizes, favorite stores, or links. Your Secret Santa sees your latest list.</p>{addOnly?<><p className="deadlineNote">Thanksgiving has passed. You may add new wishes, but may not edit or remove saved ones.</p><h3>Your saved list</h3><div className="savedWishlist">{myList||"You haven't added anything yet."}</div><form onSubmit={append}><label className="inputlabel" htmlFor="addition">Add new wishes</label><textarea id="addition" value={addition} onChange={e=>setAddition(e.target.value)} maxLength={8000} rows={4} required/><div className="formfooter"><span className="muted small">Additions are appended.</span><button disabled={busy} className="primary">Add wishes</button></div></form></>:<><p className="deadlineNote">Edit or delete anything until Thanksgiving at 11:59 PM Mountain Time. After that, add only.</p><form onSubmit={saveList}><textarea aria-label="Your wish list" value={wishlistDraft} onChange={e=>setWishlistDraft(e.target.value)} maxLength={8000} rows={12} placeholder={'Dear Secret Santa,\n\nHere are a few things I’d love…\n\n• '}/><div className="formfooter"><span className="muted small">Editable before the deadline.</span><button disabled={busy} className="primary">Save my wish list</button></div></form></>}</section></div>}<footer>Made for family, wrapped in Christmas cheer. <span>✦</span> Your assignment stays private.</footer></main></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
