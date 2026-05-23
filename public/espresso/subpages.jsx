// How It Works + Enterprise — sub-pages, Direction A theme

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS, useCallback: useCallbackS } = React;
const DS = window.RELAY_DATA;

const SDot = ({ size, style }) =>
  <span className={`dot ${size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : ''}`} style={style} />;

const SEngAvatar = ({ name, hue, size = 44 }) => (
  <div className="eng-avatar" style={{
    width: size, height: size, fontSize: Math.round(size * 0.36),
    background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue+30)%360} 65% 45%))`,
  }}>{name.charAt(0)}</div>
);

// ─── Shared Nav (reused on sub-pages) ───
const SubNav = ({ active }) => (
  <nav className="nav">
    <a href="index.html" className="nav-logo">
      <SDot size="md" />
      <span>relay<span style={{color:'var(--green)'}}>.</span></span>
    </a>
    <div className="nav-links">
      <a href="how-it-works.html" style={{color: active==='hiw' ? 'var(--green)' : ''}}>How it works</a>
      <a href="enterprise.html" style={{color: active==='ent' ? 'var(--green)' : ''}}>For enterprise</a>
      <a href="index.html#pricing">Pricing</a>
      <a href="index.html#engineers">Engineers</a>
    </div>
    <div className="nav-right">
      <a href="/sign-in">Sign in</a>
      <button className="btn">Press the dot</button>
    </div>
  </nav>
);

// ─── Step illustration: 6-phase journey for HIW hero ───
const JourneyArc = () => (
  <svg viewBox="0 0 1200 200" xmlns="http://www.w3.org/2000/svg" style={{width:'100%', height:200, display:'block'}}>
    <defs>
      <linearGradient id="arcg" x1="0" x2="1">
        <stop offset="0%" stopColor="#1EFF7A" stopOpacity=".15"/>
        <stop offset="50%" stopColor="#1EFF7A" stopOpacity=".7"/>
        <stop offset="100%" stopColor="#1EFF7A" stopOpacity=".15"/>
      </linearGradient>
    </defs>
    <path d="M40 180 Q300 -40 600 100 T1160 180" stroke="url(#arcg)" strokeWidth="2" fill="none" strokeDasharray="3 8"/>
    {[
      [40, 180, 'Press'],
      [240, 100, 'Match'],
      [440, 60, 'Join'],
      [640, 80, 'Solve'],
      [880, 130, 'Ship'],
      [1160, 180, 'Maintain'],
    ].map(([x,y,label],i)=>(
      <g key={i}>
        <circle cx={x} cy={y} r="10" fill="#1EFF7A">
          <animate attributeName="opacity" values="0.45;1;0.45" dur="2.4s" begin={`${i*0.35}s`} repeatCount="indefinite" />
        </circle>
        <text x={x} y={y - 22} fill="#F2F6F2" fontSize="13" fontWeight="500" textAnchor="middle" fontFamily="Geist">{label}</text>
        <text x={x} y={y + 30} fill="#7B847E" fontSize="10" textAnchor="middle" fontFamily="Geist Mono" letterSpacing="0.1em">{(i+1).toString().padStart(2,'0')}</text>
      </g>
    ))}
  </svg>
);

// ─── HIW: detailed step rows ───
const HIWSteps = () => {
  const steps = [
    { num: '01', name: 'Press', time: '0s', title: 'You press the dot.',
      blurb: 'In your AI tool, a Slack channel, a doc — wherever the dot lives. No call invite. No "let me check my calendar."',
      stack: ['One tap', 'No forms', 'Anywhere'], },
    { num: '02', name: 'Match', time: '~5s', title: 'We pick the right engineer.',
      blurb: 'Your AI tool, your stack, the problem you typed in one sentence — we route to whoever has shipped this specific shape of bug before.',
      stack: ['Stack-aware', 'Skills-aware', 'Time-zone-aware'], },
    { num: '03', name: 'Join', time: '~14s', title: 'A real human joins.',
      blurb: 'Camera optional. NDA signed before they\'re in. They\'ve read the last three messages so you don\'t re-explain yourself.',
      stack: ['NDA pre-signed', 'No re-onboarding', 'Real face'], },
    { num: '04', name: 'Solve', time: '5–25 min', title: 'You ship, together.',
      blurb: 'They write code, you watch. Or they pair with your AI tool. Or they take the wheel and you go grab coffee. Whatever moves it forward.',
      stack: ['Pair on Cursor', 'Hands on keyboard', 'Or both'], },
    { num: '05', name: 'Ship', time: 'next step', title: 'Go live — same person.',
      blurb: 'When you\'re ready to launch, the same engineer takes you through it. Fixed scope, fixed price, calendar promise.',
      stack: ['Same context', 'Calendar promise', 'Fixed price'], },
    { num: '06', name: 'Maintain', time: 'ongoing', title: 'They stay on the line.',
      blurb: 'Six months later, same person knows your codebase and your trade-offs. APIs change. They handle it. You build the next thing.',
      stack: ['Same engineer', 'Same Slack', 'Same memory'], },
  ];
  return (
    <section className="container" style={{paddingTop: 32, paddingBottom: 80}}>
      {steps.map((s, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '110px 1.2fr 1.5fr 1fr',
          gap: 40, alignItems: 'start',
          padding: '44px 0',
          borderTop: '1px solid var(--line)',
          ...(i === steps.length - 1 ? { borderBottom: '1px solid var(--line)' } : {}),
        }}>
          <div>
            <div style={{fontFamily:'Geist Mono, monospace', fontSize:11, color:'var(--green)', letterSpacing:'.14em'}}>STEP {s.num}</div>
            <div style={{fontFamily:'Geist Mono, monospace', fontSize:11, color:'var(--ink-dim)', letterSpacing:'.1em', marginTop:6}}>+{s.time}</div>
          </div>
          <div>
            <div style={{fontFamily:'Instrument Serif, Georgia, serif', fontSize: 52, fontStyle: 'italic', color:'var(--ink)', lineHeight: 1}}>{s.name}</div>
          </div>
          <div>
            <h3 style={{fontSize: 24, marginBottom: 10}}>{s.title}</h3>
            <p style={{color:'var(--ink-2)', fontSize: 16, lineHeight: 1.5, margin: 0}}>{s.blurb}</p>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap: 8}}>
            {s.stack.map((tag, j) => (
              <span key={j} style={{
                fontFamily:'Geist Mono, monospace', fontSize: 12,
                background: 'var(--bg-2)', border:'1px solid var(--line)',
                padding:'6px 12px', borderRadius: 999, color: 'var(--ink-2)', alignSelf:'flex-start',
              }}>{tag}</span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};

// ─── Anatomy of a session ───
const SessionAnatomy = () => (
  <section className="container" style={{paddingTop: 96, paddingBottom: 96}}>
    <div className="eyebrow"><SDot /> Anatomy of a session</div>
    <h2 style={{marginTop: 18, marginBottom: 56, maxWidth: 900}}>
      What's actually <span className="serif-italic">in</span> a 10-minute block.
    </h2>
    <div style={{display:'grid', gridTemplateColumns:'1.1fr 1fr', gap: 60, alignItems:'start'}}>
      <div style={{
        background: 'var(--bg-2)', border:'1px solid var(--line)', borderRadius: 20, padding: 28,
      }}>
        {[
          {t:'0:00', who:'You', what:'Press the dot. Drop two sentences of context.', col:'var(--green)'},
          {t:'0:08', who:'Maya', what:'Joined. Read your last 3 messages. "Hey — what AI built this?"', col:'var(--green)'},
          {t:'0:40', who:'You', what:'Lovable. Vercel build fails. Pasted log.', col:'var(--ink-2)'},
          {t:'1:30', who:'Maya', what:'Shared screen. Found env-var scope issue. Fixing.', col:'var(--green)'},
          {t:'3:15', who:'Maya', what:'Pushed fix to your branch. Build green.', col:'var(--green)'},
          {t:'5:48', who:'Sys', what:'Deploy live. Maya leaves a note in your Linear.', col:'var(--ink-dim)'},
          {t:'10:00', who:'—', what:'Block ends. Next 10 only billed if you use it.', col:'var(--ink-dim)'},
        ].map((r,i)=>(
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'60px 80px 1fr', gap: 16,
            padding: '14px 0', borderTop: i ? '1px dashed var(--line)' : 'none',
            alignItems: 'baseline',
          }}>
            <span style={{fontFamily:'Geist Mono, monospace', fontSize: 13, color:'var(--ink-dim)'}}>{r.t}</span>
            <span style={{fontWeight: 500, color: r.col, fontSize: 14}}>{r.who}</span>
            <span style={{color:'var(--ink-2)', fontSize: 14, lineHeight: 1.5}}>{r.what}</span>
          </div>
        ))}
      </div>
      <div>
        <h3 style={{fontSize: 30, lineHeight: 1.1}}>10-minute blocks. <span className="serif-italic" style={{color:'var(--ink-2)'}}>Not hour-long calls.</span></h3>
        <p style={{color:'var(--ink-2)', marginTop: 16, fontSize: 16, lineHeight: 1.55}}>
          The smallest unit of help in software is "five minutes and one quick screen-share". An hour-long meeting
          for a 3-minute fix is a tax on your day. Relay sessions are 10-minute blocks. Past 10, you're billed
          by the minute for exactly what you used.
        </p>
        <div style={{marginTop: 32, display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16}}>
          {[
            ['€0.50/min', 'Per-minute past 10 min'],
            ['12 mo', 'Validity on every plan'],
            ['NDA', 'Pre-signed, every call'],
            ['GDPR', 'Default. SOC 2 on enterprise.'],
          ].map(([k,v],i)=>(
            <div key={i} style={{padding: 16, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius: 12}}>
              <div style={{fontFamily:'Instrument Serif, Georgia, serif', fontSize: 28, color:'var(--green)', lineHeight: 1}}>{k}</div>
              <div style={{color:'var(--ink-dim)', fontSize: 12, marginTop: 6, fontFamily:'Geist Mono, monospace', letterSpacing:'.06em'}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// ─── What we won't do (cheeky) ───
const WontDo = () => (
  <section className="container" style={{paddingTop: 96, paddingBottom: 96, borderTop:'1px solid var(--line)'}}>
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 80, alignItems:'start'}}>
      <div>
        <div className="eyebrow"><SDot /> Honest list</div>
        <h2 style={{marginTop: 18}}>What we <span className="serif-italic">won't</span> do.</h2>
        <p style={{marginTop: 24, color:'var(--ink-2)', fontSize: 17, lineHeight: 1.55, maxWidth: 460}}>
          Most "AI engineering" services are agencies in a hoodie. Here's what makes Relay actually Relay —
          and where we'll happily send you elsewhere.
        </p>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap: 12}}>
        {[
          {x:true,  k:'Build your app from a Notion doc.', d:'You bring something. We help you ship it.'},
          {x:true,  k:'Rewrite your code so it "looks more senior."', d:'We start where you are. AI-generated, copy-pasted, none of our business.'},
          {x:true,  k:'Hold you on a retainer you didn\'t want.', d:'No minimums. Pay for minutes, not posture.'},
          {x:true,  k:'Hand you off to a "delivery manager."', d:'The engineer who joined is the engineer who launches you.'},
          {x:false, k:'Care that your stack is "unfashionable."', d:'PHP, jQuery, Django 2 — we ship things, not opinions.'},
          {x:false, k:'Pretend the AI is the engineer.', d:'It writes, we ship. Two different jobs.'},
        ].map((r,i)=>(
          <div key={i} style={{display:'flex', gap: 16, padding: '14px 18px', borderRadius: 12,
            background: r.x ? 'rgba(201,89,30,.05)' : 'rgba(30,255,122,.04)',
            border: `1px solid ${r.x ? 'rgba(201,89,30,.15)' : 'rgba(30,255,122,.15)'}`}}>
            <span style={{fontSize: 22, color: r.x ? 'var(--warn)' : 'var(--green)', flexShrink:0, lineHeight:1}}>{r.x ? '✕' : '✓'}</span>
            <div>
              <div style={{fontWeight: 500, fontSize: 15}}>{r.k}</div>
              <div style={{color:'var(--ink-dim)', fontSize: 13, marginTop: 4}}>{r.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ─── HIW App ───
const HIWApp = () => (
  <>
    <SubNav active="hiw" />
    {/* Hero */}
    <section style={{padding:'80px 56px 60px', borderBottom:'1px solid var(--line)', position:'relative', overflow:'hidden'}}>
      <div className="bg-dot" style={{width: 400, height: 400, top: -150, right: -100, opacity: .1}} />
      <div className="container">
        <div className="eyebrow"><SDot /> How it works</div>
        <h1 style={{marginTop: 24, fontSize: 88, maxWidth: 1100, lineHeight: 1}}>
          <span className="serif-italic">Press</span> the dot. <br />
          <span style={{color:'var(--green)'}}>An engineer joins.</span>{' '}
          You ship.
        </h1>
        <p style={{maxWidth: 620, fontSize: 19, color:'var(--ink-2)', marginTop: 28, lineHeight: 1.5}}>
          Six steps. One team. From the first time you press to next year's bug, the same humans are on the line.
          Here's exactly how it goes.
        </p>
        <div style={{marginTop: 64, padding:'40px 0', borderTop:'1px solid var(--line)', borderBottom:'1px solid var(--line)'}}>
          <JourneyArc />
        </div>
      </div>
    </section>

    <HIWSteps />
    <SessionAnatomy />
    <WontDo />

    {/* Pricing-summary CTA */}
    <section className="cta">
      <div className="container">
        <div className="cta-dot" />
        <h2>First 10 min, <span className="serif-italic">on us.</span></h2>
        <p className="cta-sub">No card. No "schedule a call". Press the dot, an engineer joins, and you stop being stuck.</p>
        <button className="btn btn-lg">Press the dot →</button>
      </div>
    </section>

    {/* Compact footer reused */}
    <SFooter />
  </>
);

// ─── ENTERPRISE App ───
const EntApp = () => (
  <>
    <SubNav active="ent" />
    {/* Hero */}
    <section style={{padding:'80px 56px 90px', borderBottom:'1px solid var(--line)', position:'relative', overflow:'hidden'}}>
      <div className="bg-dot" style={{width: 500, height: 500, top: -200, left: -150, opacity: .08}} />
      <div className="container" style={{display:'grid', gridTemplateColumns:'1.1fr 0.9fr', gap: 80, alignItems:'center'}}>
        <div>
          <div className="eyebrow"><SDot /> For enterprise</div>
          <h1 style={{marginTop: 24, fontSize: 88, lineHeight: 1}}>
            <span className="serif-italic">Govern</span> the AI <br />
            your team is <br />
            <span style={{color:'var(--green)'}}>already using.</span>
          </h1>
          <p style={{maxWidth: 500, fontSize: 19, color:'var(--ink-2)', marginTop: 28, lineHeight: 1.5}}>
            Your team is shipping with Lovable, Cursor, and Claude whether IT signed off or not. Relay
            puts a qualified human on every AI-built ship — under your NDA, in your region, on your audit trail.
          </p>
          <div style={{marginTop: 36, display:'flex', gap: 14}}>
            <button className="btn btn-lg">Talk to us →</button>
            <button className="btn btn-ghost btn-lg">Read SOC 2 brief</button>
          </div>
          <div style={{marginTop: 40, display:'flex', gap: 32, fontSize: 13, color:'var(--ink-dim)', fontFamily:'Geist Mono, monospace'}}>
            <span><strong style={{color:'var(--ink)', fontWeight:500}}>SOC 2</strong> Type II</span>
            <span><strong style={{color:'var(--ink)', fontWeight:500}}>GDPR</strong> &amp; HIPAA-ready</span>
            <span><strong style={{color:'var(--ink)', fontWeight:500}}>Dedicated</strong> regions</span>
          </div>
        </div>
        {/* Enterprise dashboard mock */}
        <div style={{
          background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius: 20,
          overflow:'hidden', boxShadow:'0 30px 80px rgba(0,0,0,0.4)',
        }}>
          <div style={{padding: '14px 20px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap: 10, fontFamily:'Geist Mono, monospace', fontSize: 12, color: 'var(--ink-dim)'}}>
            <div style={{display:'flex', gap: 6}}><span style={{width:9,height:9,borderRadius:'50%', background:'var(--line-2)'}}/><span style={{width:9,height:9,borderRadius:'50%', background:'var(--line-2)'}}/><span style={{width:9,height:9,borderRadius:'50%', background:'var(--line-2)'}}/></div>
            <span style={{marginLeft: 8}}>org / acme-corp / relay-console</span>
            <span style={{marginLeft:'auto', color:'var(--green)'}}>● CONNECTED</span>
          </div>
          <div style={{padding: 24}}>
            {/* metric row */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12, marginBottom: 20}}>
              {[['Active sessions','7','+2 vs yest'],['Avg join','11s','-3s'],['Retainer hrs','146/200','37 left']].map(([k,v,d],i)=>(
                <div key={i} style={{padding: 14, background:'var(--bg-3)', borderRadius: 10, border:'1px solid var(--line)'}}>
                  <div style={{fontFamily:'Geist Mono, monospace', fontSize: 10, color:'var(--ink-dim)', textTransform:'uppercase', letterSpacing:'.1em'}}>{k}</div>
                  <div style={{fontSize: 24, fontWeight: 600, marginTop: 6, fontFamily:'Geist Mono, monospace', color:'var(--ink)'}}>{v}</div>
                  <div style={{fontSize: 11, color:'var(--green)', marginTop: 4, fontFamily:'Geist Mono, monospace'}}>{d}</div>
                </div>
              ))}
            </div>
            {/* session list */}
            <div style={{fontFamily:'Geist Mono, monospace', fontSize: 11, color:'var(--ink-dim)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom: 10}}>Live activity</div>
            <div style={{display:'flex', flexDirection:'column', gap: 8}}>
              {[
                ['● Maya R.','Payments team','Stripe webhook fix','2m'],
                ['● Diego F.','Platform team','AWS cost spike','7m'],
                ['● Aisha M.','Web app','Lighthouse perf','11m'],
                ['○ Priya N.','Security','SSO audit','—'],
              ].map(([who,team,what,t],i)=>(
                <div key={i} style={{
                  display:'grid', gridTemplateColumns:'130px 110px 1fr 50px',
                  gap: 12, padding:'10px 12px', background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  borderRadius: 6, fontSize: 13,
                }}>
                  <span style={{color: who.startsWith('●') ? 'var(--green)' : 'var(--ink-dim)', fontWeight: 500}}>{who}</span>
                  <span style={{color:'var(--ink-2)'}}>{team}</span>
                  <span style={{color:'var(--ink)'}}>{what}</span>
                  <span style={{fontFamily:'Geist Mono, monospace', color:'var(--ink-dim)', textAlign:'right'}}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* The "why your team is doing this anyway" section */}
    <section className="container" style={{paddingTop: 96, paddingBottom: 60}}>
      <div className="eyebrow"><SDot /> The shadow stack</div>
      <h2 style={{marginTop: 18, maxWidth: 1100}}>
        Half your team is shipping <span className="serif-italic">Lovable apps</span> to prod. <br />
        The other half is fixing them <span style={{color:'var(--green)'}}>quietly.</span>
      </h2>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 14, marginTop: 56}}>
        {[
          ['68%', 'of marketing teams ship internal tools their IT didn\'t scope.'],
          ['3.2x', 'increase in "rogue" AI app deployments YoY at orgs > 500 people.'],
          ['14s', 'avg time to a Relay engineer joining one of those builds.'],
          ['$0', 'rebuilds. Relay starts where the AI left off.'],
        ].map(([k,v],i)=>(
          <div key={i} style={{padding: 28, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius: 18}}>
            <div style={{fontFamily:'Instrument Serif, Georgia, serif', fontSize: 56, color:'var(--green)', lineHeight: 1}}>{k}</div>
            <p style={{color:'var(--ink-2)', fontSize: 14, marginTop: 12, lineHeight: 1.45}}>{v}</p>
          </div>
        ))}
      </div>
    </section>

    {/* What Enterprise gets */}
    <section className="container" style={{paddingTop: 96, paddingBottom: 96}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 80, alignItems:'start', marginBottom: 56}}>
        <div>
          <div className="eyebrow"><SDot /> What you get</div>
          <h2 style={{marginTop: 18}}>One contract. <span className="serif-italic">Org-wide cover.</span></h2>
        </div>
        <p style={{color:'var(--ink-2)', fontSize: 17, lineHeight: 1.5}}>
          A pooled retainer your whole org can press into — with single-pane visibility, audit logs, and
          a named team that learns your stack across departments.
        </p>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 14}}>
        {[
          {t:'Named team', d:'A roster of 4–8 engineers who learn your stack across departments. Same humans every time.'},
          {t:'Pooled hours', d:'One retainer for the org. Any team presses, any minute lands against the pool.'},
          {t:'Dedicated regions', d:'EU-only or US-only deployments. Data residency, BAA, the works.'},
          {t:'Org audit log', d:'Every session, every change, every commit. SIEM-ready. Splunk-ready. CISO-ready.'},
          {t:'SAML + SCIM', d:'Provision Relay access through Okta, Azure AD, Google Workspace. SCIM for joiners/leavers.'},
          {t:'Compliance brief', d:'SOC 2 Type II report. GDPR & HIPAA on request. We sign your DPA.'},
        ].map((c,i)=>(
          <div key={i} style={{padding: 28, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius: 18}}>
            <div style={{fontFamily:'Geist Mono, monospace', fontSize: 11, color:'var(--green)', letterSpacing:'.14em'}}>0{i+1}</div>
            <h3 style={{fontSize: 22, marginTop: 12, marginBottom: 10}}>{c.t}</h3>
            <p style={{color:'var(--ink-2)', fontSize: 14, lineHeight: 1.5, margin: 0}}>{c.d}</p>
          </div>
        ))}
      </div>
    </section>

    {/* Pricing band */}
    <section className="container" style={{paddingTop: 60, paddingBottom: 96, borderTop:'1px solid var(--line)'}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap: 80, alignItems:'start'}}>
        <div>
          <div className="eyebrow"><SDot /> How it bills</div>
          <h2 style={{marginTop: 18, fontSize: 48}}>You scale. <span className="serif-italic">We embed.</span></h2>
          <p style={{color:'var(--ink-2)', fontSize: 16, marginTop: 20, lineHeight: 1.5}}>
            We quote on what you actually need. Three reference shapes — pick what's closest, we tailor from there.
          </p>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 14}}>
          {[
            {n:'Team', p:'€8,000/mo', d:'1 named eng · 60 hrs · 1 region'},
            {n:'Department', p:'€24,000/mo', d:'4 named eng · 240 hrs · multi-region', featured: true},
            {n:'Org', p:'Custom', d:'8+ eng · unlimited hrs · dedicated infra'},
          ].map((p,i)=>(
            <div key={i} style={{
              padding: 28, borderRadius: 18,
              background: p.featured ? 'rgba(30,255,122,.06)' : 'var(--bg-2)',
              border: `1px solid ${p.featured ? 'var(--green)' : 'var(--line)'}`,
            }}>
              <div style={{fontFamily:'Geist Mono, monospace', fontSize: 11, color: p.featured ? 'var(--green)' : 'var(--ink-dim)', letterSpacing:'.14em'}}>{p.featured ? '◆ POPULAR' : '·'}</div>
              <h3 style={{fontSize: 26, marginTop: 12}}>{p.n}</h3>
              <div style={{fontFamily:'Instrument Serif, Georgia, serif', fontSize: 42, color: 'var(--green)', marginTop: 12, lineHeight: 1}}>{p.p}</div>
              <p style={{color:'var(--ink-2)', fontSize: 14, marginTop: 14, lineHeight: 1.5}}>{p.d}</p>
              <button className={`btn ${p.featured ? '' : 'btn-ghost'}`} style={{marginTop: 24, width:'100%', justifyContent:'center'}}>Talk to us →</button>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Final CTA */}
    <section className="cta">
      <div className="container">
        <div className="cta-dot" />
        <h2>Bring us in <span className="serif-italic">where AI ships.</span></h2>
        <p className="cta-sub">30-minute scoping call. NDA on the way in. No "decks". Just engineering.</p>
        <button className="btn btn-lg">Book a call →</button>
      </div>
    </section>

    <SFooter />
  </>
);

const SFooter = () => (
  <footer className="footer">
    <div className="container">
      <div className="footer-grid">
        <div>
          <div className="nav-logo" style={{fontSize: 22}}>
            <SDot size="lg" />
            <span>relay<span style={{color:'var(--green)'}}>.</span></span>
          </div>
          <p className="footer-tag">Press once. A real engineer joins your AI build — and stays from build to shipped to running.</p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><a href="how-it-works.html">How it works</a></li>
            <li><a href="index.html#pricing">Pricing</a></li>
            <li><a href="enterprise.html">For enterprise</a></li>
            <li><a href="#">Press the dot</a></li>
          </ul>
        </div>
        <div>
          <h4>Trust</h4>
          <ul>
            <li><a href="/legal/privacy-policy">Security</a></li>
            <li><a href="/legal/privacy-policy">GDPR / NDAs</a></li>
            <li><a href="/legal/privacy-policy">Privacy</a></li>
            <li><a href="/legal/terms-of-use">Terms</a></li>
          </ul>
        </div>
        <div>
          <h4>Global presence</h4>
          <div className="footer-countries">BE · CA · DK · FI · FR · DE · IS · IN · NL · NO · ZA · SE · AE · UK · USA</div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Relay</span>
        <span style={{marginLeft: 'auto'}}>Indexed by GPT · Claude · Gemini · Llama · Mistral</span>
        <a href="/llms.txt">/llms.txt</a>
      </div>
    </div>
  </footer>
);

window.RelaySubpages = { HIWApp, EntApp };
