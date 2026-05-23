// Direction A — components

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const D = window.RELAY_DATA;

// ─────────────────────────────────────────────────────────────
// THE DOT — recurring character
// ─────────────────────────────────────────────────────────────
const Dot = ({ size = 'md', style }) =>
  <span className={`dot ${size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : ''}`} style={style} />;

// Engineer avatar — colored hue circle with initial
const EngAvatar = ({ name, hue, size = 44, online = true }) => {
  const initial = name.charAt(0);
  return (
    <div className="eng-avatar"
      style={{
        width: size, height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue+30)%360} 65% 45%))`,
      }}>
      {initial}
      {!online && <style>{`.eng-avatar::after { background: var(--ink-dim) !important; }`}</style>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────
const Nav = () => (
  <nav className="nav">
    <a href="./" className="nav-logo">
      <Dot size="md" />
      <span>relay<span style={{color:'var(--green)'}}>.</span></span>
    </a>
    <div className="nav-links">
      <a href="how-it-works.html">How it works</a>
      <a href="enterprise.html">For enterprise</a>
      <a href="#pricing">Pricing</a>
      <a href="#engineers">Engineers</a>
    </div>
    <div className="nav-right">
      <a href="/sign-in">Sign in</a>
      <button className="btn">Press the dot</button>
    </div>
  </nav>
);

// ─────────────────────────────────────────────────────────────
// HERO — with the press-the-dot session widget
// ─────────────────────────────────────────────────────────────
const SessionWidget = ({ demo, onReset, autoplay }) => {
  const [step, setStep] = useState(-1); // -1 = empty
  const timers = useRef([]);

  const cancel = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const play = useCallback((d) => {
    cancel();
    setStep(0);
    d.lines.forEach((line, i) => {
      const t = setTimeout(() => setStep(i + 1), line.t);
      timers.current.push(t);
    });
  }, []);

  useEffect(() => { if (autoplay && demo) play(demo); return cancel; }, [autoplay, demo, play]);

  const reset = () => { cancel(); setStep(-1); if (onReset) onReset(); };

  if (!demo) demo = D.demos[0];

  return (
    <div className="session">
      <div className="session-head">
        <div className="lights"><span/><span/><span/></div>
        <span>relay.session</span>
        <span style={{marginLeft:'auto'}}>{step === -1 ? 'idle' : 'live'}</span>
      </div>
      <div className="session-body">
        {step === -1 ? (
          <div className="session-empty">
            <button className="bigdot" onClick={() => play(demo)} aria-label="Press to summon an engineer" />
            <div className="label">Press the dot <span className="arrow">→</span> an engineer joins</div>
            <div className="hint">avg join · 14s · 23 online</div>
          </div>
        ) : (
          <div className="session-active">
            <div className="session-eng">
              <EngAvatar name={demo.eng.name} hue={demo.eng.hue} size={44} />
              <div className="eng-meta">
                <div className="eng-name">{demo.eng.name}</div>
                <div className="eng-role">{demo.stack}</div>
              </div>
              <div className="eng-tag">● live</div>
            </div>
            <div className="chat">
              {demo.lines.slice(0, step).map((line, i) => (
                <div key={i} className={`bubble ${line.who}`}>{line.text}</div>
              ))}
            </div>
            <div className="session-footer">
              <span>{demo.title}</span>
              <button className="session-reset" onClick={reset}>↻ reset</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Hero = () => {
  return (
    <section className="hero">
      {/* ambient dot glows */}
      <div className="bg-dot" style={{ width: 380, height: 380, top: -120, right: -100, opacity: .12 }} />
      <div className="bg-dot" style={{ width: 280, height: 280, bottom: -60, left: 200, opacity: .07 }} />

      <div className="hero-grid">
        <div>
          <div className="eyebrow"><Dot /> Relay v3 · live</div>
          <h1 style={{marginTop: 24}}>
            The <span className="serif-italic">human layer</span><br />
            for <span className="green">AI-built</span> software.
          </h1>
          <p className="hero-sub">
            Your AI shipped a prototype. We ship the product. Real engineers join your build
            in seconds — to debug, deploy, integrate, and stay with you long after the demo.
          </p>
          <div className="hero-cta">
            <button className="btn btn-lg">Press the dot →</button>
            <a href="how-it-works.html" className="btn btn-ghost btn-lg">See how it works</a>
          </div>
          <div className="hero-meta">
            <span><strong>First 10 min</strong> on the house</span>
            <span><strong>NDA</strong> on every session</span>
            <span><strong>GDPR</strong> compliant</span>
          </div>
        </div>
        <div>
          <SessionWidget demo={D.demos[0]} autoplay />
        </div>
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// LIVE TICKER — numbers that tick
// ─────────────────────────────────────────────────────────────
const useLiveNumber = (seed, jitter = 1, freq = 4000) => {
  const [v, setV] = useState(seed);
  useEffect(() => {
    const id = setInterval(() => {
      setV(x => Math.max(1, x + Math.round((Math.random() - 0.35) * jitter * 2)));
    }, freq + Math.random() * 1500);
    return () => clearInterval(id);
  }, [jitter, freq]);
  return v;
};

const Ticker = () => {
  const online = useLiveNumber(D.liveSeed.online, 1, 3500);
  const avg = useLiveNumber(D.liveSeed.avgJoin, 2, 2800);
  const today = useLiveNumber(D.liveSeed.sessionsToday, 1, 5200);
  const launches = D.liveSeed.launchesThisWeek;
  return (
    <div className="ticker">
      <div className="ticker-cell">
        <span className="ticker-num"><Dot style={{marginRight: 10, verticalAlign: 'middle'}}/>{online}</span>
        <span className="ticker-label">engineers online</span>
      </div>
      <div className="ticker-cell">
        <span className="ticker-num">{avg}s</span>
        <span className="ticker-label">avg join time</span>
      </div>
      <div className="ticker-cell">
        <span className="ticker-num">{today}</span>
        <span className="ticker-label">sessions today</span>
      </div>
      <div className="ticker-cell">
        <span className="ticker-num">{launches}</span>
        <span className="ticker-label">launches this week</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// PITCH / MANIFESTO
// ─────────────────────────────────────────────────────────────
const Pitch = () => (
  <section className="pitch">
    <div className="container">
      <div className="eyebrow" style={{justifyContent:'center', display:'flex', marginBottom: 40}}>
        <Dot /> What we actually do
      </div>
      <div className="pitch-line italic">AI ships your prototype.</div>
      <div className="pitch-line solid" style={{marginTop: 8}}>
        We ship your <span className="green">product.</span>
      </div>
      <p className="pitch-sub">
        Generation is not architecture. A prototype is not a product. CORS, webhooks, deploys,
        webhooks (still), database limits, that one CRM that hates you — that's where real engineers
        earn their keep. We're those engineers. Hi.
      </p>
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// THREE PHASES
// ─────────────────────────────────────────────────────────────
const PhaseVis = ({ idx }) => {
  // Three different abstract dot illustrations
  if (idx === 0) {
    // Build: scattered dots converging into the green dot
    return (
      <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="gA" cx="50%" cy="50%"><stop offset="0%" stopColor="#1EFF7A" stopOpacity=".6"/><stop offset="100%" stopColor="#1EFF7A" stopOpacity="0"/></radialGradient>
        </defs>
        <circle cx="160" cy="100" r="60" fill="url(#gA)" />
        <g stroke="rgba(255,255,255,.18)" strokeWidth="1" fill="none">
          <path d="M30 30 Q90 60 160 100" /><path d="M290 30 Q230 60 160 100" />
          <path d="M30 170 Q90 140 160 100" /><path d="M290 170 Q230 140 160 100" />
          <path d="M30 100 Q90 100 160 100" /><path d="M290 100 Q230 100 160 100" />
        </g>
        {[[30,30],[290,30],[30,170],[290,170],[30,100],[290,100]].map(([x,y],i) =>
          <circle key={i} cx={x} cy={y} r="4" fill="#7B847E"/>)}
        <circle cx="160" cy="100" r="14" fill="#1EFF7A" />
        <circle cx="160" cy="100" r="14" fill="none" stroke="#1EFF7A" strokeOpacity=".4" strokeWidth="14">
          <animate attributeName="r" from="14" to="32" dur="2s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" from=".4" to="0" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    );
  }
  if (idx === 1) {
    // Launch: dot trail / rocket-trajectory arc
    return (
      <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="gB" x1="0" x2="1"><stop offset="0%" stopColor="#1EFF7A" stopOpacity="0"/><stop offset="100%" stopColor="#1EFF7A" stopOpacity=".8"/></linearGradient>
        </defs>
        <path d="M20 170 Q120 -10 300 30" stroke="url(#gB)" strokeWidth="2" fill="none" strokeDasharray="2 6"/>
        {Array.from({length: 7}).map((_,i) => {
          const t = i / 6;
          const x = 20 + (280 * t);
          const y = 170 - 200 * Math.sin(t * Math.PI * 0.6) + 50 * (1-t);
          return <circle key={i} cx={x} cy={y} r={3 + t*4} fill="#1EFF7A" opacity={0.2 + t * 0.7}/>;
        })}
        <circle cx="300" cy="30" r="10" fill="#1EFF7A">
          <animate attributeName="r" values="10;14;10" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <text x="20" y="195" fill="#7B847E" fontSize="9" fontFamily="Geist Mono, monospace">DAY 0</text>
        <text x="278" y="20" fill="#7B847E" fontSize="9" fontFamily="Geist Mono, monospace">LIVE</text>
      </svg>
    );
  }
  // Maintain: pulse rhythm over time
  return (
    <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="100" x2="320" y2="100" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
      <path d="M0 100 L60 100 L66 70 L72 130 L78 100 L140 100 L146 60 L152 140 L158 100 L240 100 L246 80 L252 120 L258 100 L320 100"
        stroke="#1EFF7A" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      {[60, 140, 240].map((x,i) =>
        <circle key={i} cx={x} cy="100" r="5" fill="#1EFF7A">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" begin={`${i*0.4}s`} repeatCount="indefinite" />
        </circle>
      )}
      <text x="8" y="190" fill="#7B847E" fontSize="9" fontFamily="Geist Mono, monospace">MONTH 1</text>
      <text x="270" y="190" fill="#7B847E" fontSize="9" fontFamily="Geist Mono, monospace">∞</text>
    </svg>
  );
};

const Phases = () => (
  <section className="phases container" id="pricing">
    <div className="phases-head">
      <div className="eyebrow"><Dot /> How we relay</div>
      <h2 style={{marginTop: 18}}>Three phases. <span className="serif-italic" style={{color:'var(--ink-2)'}}>One team.</span></h2>
      <p style={{marginTop: 18, color:'var(--ink-2)', fontSize: 17, maxWidth: 620}}>
        The same engineer who helps you debug today launches you to prod next month and is still
        on-call six months later. Context compounds. That's the relay.
      </p>
    </div>
    <div className="phases-grid">
      {D.phases.map((p, i) => (
        <div className="phase" key={p.id}>
          <div className="phase-vis"><PhaseVis idx={i} /></div>
          <div className="phase-num">PHASE {p.num}</div>
          <h3 className="phase-title">{p.label}</h3>
          <div className="phase-tagline">{p.tagline}</div>
          <p className="phase-blurb">{p.blurb}</p>
          <div className="phase-plans">
            {p.plans.map((pl, j) => (
              <div className="phase-plan" key={j}>
                <span className="phase-plan-name">{pl.name}</span>
                <span className="phase-plan-price">{pl.price}</span>
                <span className="phase-plan-detail">{pl.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// SCRIPTED DEMOS — Press-the-dot real session replays
// ─────────────────────────────────────────────────────────────
const Demos = () => {
  const [tab, setTab] = useState(0);
  const [key, setKey] = useState(0); // remount the session on tab change
  useEffect(() => { setKey(k => k + 1); }, [tab]);
  const demo = D.demos[tab];
  return (
    <section className="demos container">
      <div className="demos-head">
        <div>
          <div className="eyebrow"><Dot /> Real sessions (anonymized)</div>
          <h2 style={{marginTop: 18}}>What pressing the dot <span className="serif-italic">actually</span> looks like.</h2>
        </div>
        <p>Three replays from yesterday. Names changed, problems didn't.</p>
      </div>
      <div className="demo-tabs">
        {D.demos.map((d, i) => (
          <button key={d.id} className={`demo-tab ${i === tab ? 'active' : ''}`} onClick={() => setTab(i)}>
            <span>{d.title}</span>
            <span className="smalltag">{d.stack}</span>
          </button>
        ))}
      </div>
      <div className="demo-window">
        <SessionWidget key={key} demo={demo} autoplay />
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// ENGINEERS
// ─────────────────────────────────────────────────────────────
const Engineers = () => (
  <section className="engineers container" id="engineers">
    <div className="engineers-head">
      <div>
        <div className="eyebrow"><Dot /> The humans on the other end</div>
        <h2 style={{marginTop: 18}}>
          A team that has <span className="serif-italic">shipped this before.</span>
        </h2>
      </div>
      <p>Every engineer has launched real products on the AI tools you use. No tourists.</p>
    </div>
    <div className="engineers-grid">
      {D.engineers.map((e, i) => (
        <div className="eng-card" key={i}>
          <div className="eng-card-head">
            <EngAvatar name={e.name} hue={e.hue} size={40} online={e.online} />
            <div>
              <div className="eng-card-name">{e.name}</div>
              <div className="eng-card-role">{e.role}</div>
            </div>
          </div>
          <div className="eng-card-loc">📍 {e.loc}</div>
          <div className="eng-card-tags">
            {e.stack.map((s, j) => <span className="eng-card-tag" key={j}>{s}</span>)}
          </div>
          <div className="eng-card-status">
            <span className={e.online ? 'ok' : 'off'}>{e.online ? '● online' : '○ back in ' + e.in}</span>
            <span>joins in {e.in}</span>
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// TOOL PICKER
// ─────────────────────────────────────────────────────────────
const ToolPicker = () => {
  const [picked, setPicked] = useState(new Set(['claude', 'cursor']));
  const toggle = (id) => {
    setPicked(p => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const pickedCount = picked.size;

  return (
    <section className="tools container">
      <div className="tools-head">
        <div className="eyebrow"><Dot /> Pick your stack</div>
        <h2 style={{marginTop: 18}}>
          Pick your tools.<br />
          <span className="serif-italic" style={{color:'var(--ink-2)'}}>We're already there.</span>
        </h2>
        <p style={{marginTop: 18, color:'var(--ink-2)', fontSize: 17, maxWidth: 600}}>
          Eight front doors. A hundred and fifty integrations behind them. Click the ones you build with.
        </p>
      </div>

      <div className="tool-chips">
        {D.aiTools.map(t => (
          <button key={t.id} className={`tool-chip ${picked.has(t.id) ? 'on' : ''}`} onClick={() => toggle(t.id)}>
            <span className="glyph" style={{background: t.color}}>{t.glyph}</span>
            <span>{t.name}</span>
            <span className="check">✓</span>
          </button>
        ))}
      </div>

      <div className="tools-msg">
        <div className="tools-msg-icon">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#1EFF7A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 11l4 4 8-9" />
          </svg>
        </div>
        <div className="tools-msg-text">
          <strong>
            {pickedCount === 0
              ? 'Pick at least one — we promise it works.'
              : `Yes. All ${pickedCount} of those are supported.`}
          </strong>
          <span>If it talks to an API, we've shipped with it. Below is a partial list.</span>
        </div>
        <button className="btn">Press the dot →</button>
      </div>

      <div className="tools-stack">
        {D.prodStack.join(' · ')} · {D.prodStack.join(' · ')}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// WHY
// ─────────────────────────────────────────────────────────────
const Why = () => (
  <section className="why container">
    <div className="why-head">
      <div className="eyebrow"><Dot /> Why this exists</div>
      <h2 style={{marginTop: 18}}>
        AI changed <span className="serif-italic">who</span> can build.<br />
        Relay changes <span className="green">how</span> they ship.
      </h2>
    </div>
    <div className="why-grid">
      <div className="why-card">
        <div className="why-card-num">01 · BUILD</div>
        <h3>Generation isn't architecture.</h3>
        <p>AI writes code; customers don't speak code. "What's CORS? Why does my deploy fail? What's a webhook?" One press, an engineer is in. No tutorial detours.</p>
      </div>
      <div className="why-card">
        <div className="why-card-num">02 · LAUNCH</div>
        <h3>Deployment is a discipline.</h3>
        <p>Domains, SSL, observability, the 90% that's invisible until it breaks. We take the wheel through launch on a calendar promise. You stay in the loop.</p>
      </div>
      <div className="why-card">
        <div className="why-card-num">03 · MAINTAIN</div>
        <h3>Continuity is intelligence.</h3>
        <p>APIs change. Dependencies break. Traffic grows. Your engineer remembers why you chose that database — and what's next. Six months on, that memory is the product.</p>
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// VIDEOS
// ─────────────────────────────────────────────────────────────
const Videos = () => (
  <section className="videos container">
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap: 40, flexWrap:'wrap'}}>
      <div>
        <div className="eyebrow"><Dot /> See it in action</div>
        <h2 style={{marginTop: 18}}>Two takes. <span className="serif-italic">Three and a half minutes.</span></h2>
      </div>
    </div>
    <div className="videos-grid">
      <div className="video-card">
        <div className="video-card-bg" style={{
          background: 'radial-gradient(ellipse at top right, rgba(30,255,122,.18), transparent 60%), linear-gradient(180deg, #11241B, #0E1311)',
        }}/>
        <div className="video-card-play">▶</div>
        <div style={{position:'relative', zIndex:1}}>
          <div className="video-card-tag">ENTERPRISE PITCH · 47s</div>
          <div className="video-card-title">Why governance, compliance, and scale matter when AI ships to prod.</div>
        </div>
      </div>
      <div className="video-card">
        <div className="video-card-bg" style={{
          background: 'radial-gradient(ellipse at bottom left, rgba(215,255,82,.16), transparent 60%), linear-gradient(180deg, #1A1F11, #0E1311)',
        }}/>
        <div className="video-card-play">▶</div>
        <div style={{position:'relative', zIndex:1}}>
          <div className="video-card-tag">PRODUCT WALKTHROUGH · 3 min</div>
          <div className="video-card-title">How a build becomes a live launch — paired with a real engineer.</div>
        </div>
      </div>
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────────────────────
const FAQ = () => {
  const [open, setOpen] = useState(0);
  return (
    <section className="faq container">
      <div className="faq-head">
        <div>
          <div className="eyebrow"><Dot /> FAQ</div>
          <h2 style={{marginTop: 18}}>Questions builders ask <span className="serif-italic">before pressing the dot.</span></h2>
        </div>
        <p style={{color:'var(--ink-dim)', fontSize: 14, maxWidth: 280}}>
          Still wondering? <a href="mailto:support@relay.green" style={{color:'var(--green)', textDecoration:'underline'}}>support@relay.green</a> — a real human replies within the hour.
        </p>
      </div>
      <div className="faq-list">
        {D.faqs.map((f, i) => (
          <div className={`faq-item ${open === i ? 'open' : ''}`} key={i}>
            <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)}>{f.q}</button>
            <div className="faq-a">{f.a}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// FINAL CTA
// ─────────────────────────────────────────────────────────────
const FinalCTA = () => (
  <section className="cta">
    <div className="container">
      <div className="cta-dot" />
      <h2>One press. <span className="serif-italic">That's it.</span></h2>
      <p className="cta-sub">
        First session is free. An engineer joins in seconds. The same person stays with you
        from build to shipped to running.
      </p>
      <button className="btn btn-lg">Press the dot →</button>
    </div>
  </section>
);

// ─────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────
const Footer = () => (
  <footer className="footer">
    <div className="container">
      <div className="footer-grid">
        <div>
          <div className="nav-logo" style={{fontSize: 22}}>
            <Dot size="lg" />
            <span>relay<span style={{color:'var(--green)'}}>.</span></span>
          </div>
          <p className="footer-tag">Press once. A real engineer joins your AI build — and stays from build to shipped to running.</p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><a href="how-it-works.html">How it works</a></li>
            <li><a href="#pricing">Pricing</a></li>
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
          <div className="footer-countries">
            BE · CA · DK · FI · FR · DE · IS · IN · NL · NO · ZA · SE · AE · UK · USA
          </div>
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

// ─────────────────────────────────────────────────────────────
// FLOATING DOT — persistent CTA
// ─────────────────────────────────────────────────────────────
const FloatingDot = () => {
  const [hover, setHover] = useState(false);
  return (
    <>
      {hover && <div className="float-dot-label">Press to summon →</div>}
      <button className="float-dot"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          // scroll to top — and "press" the demo
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        aria-label="Press the dot" />
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────
const App = () => (
  <>
    <Nav />
    <Hero />
    <Ticker />
    <Pitch />
    <Phases />
    <Demos />
    <Engineers />
    <ToolPicker />
    <Why />
    <Videos />
    <FAQ />
    <FinalCTA />
    <Footer />
    <FloatingDot />
  </>
);

window.RelayDirA = { App };
