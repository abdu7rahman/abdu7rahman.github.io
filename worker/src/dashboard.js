/* The dashboard, served only to a signed-in session.
 *
 * Set in the portfolio's own type and colours so it reads as part of the same
 * thing. Two rules from the site carry over: the accent is the red, and no
 * number is drawn that was not measured -- an empty table says it is empty
 * rather than showing a zero row that looks like data.
 *
 * Forms are chosen by what each number is for. The five headline figures are
 * stat tiles, because a single value is not a chart. Change over time is a two
 * series line. Everything categorical -- pages, demos, destinations, places --
 * is a table with a magnitude bar behind the label, because the labels are text
 * of wildly different lengths and a bar chart of those is unreadable.
 *
 * The two line colours were run through a CVD check rather than picked:
 * #d70015 against #007a3d is deuteranopia dE 9.1, above the 8 threshold, and
 * both are direct-labelled anyway so identity never rests on hue alone.
 */

const SHELL = `
:root{
  --paper:#fbfbfd; --paper-2:#f5f5f7; --paper-3:#fff;
  --ink:#1d1d1f; --ink-2:#424245; --ink-3:#6e6e73;
  --rule:#e8e8ed; --rule-2:#d2d2d7;
  --signal:#d70015; --accent:#007a3d;
  --r-pill:980px; --r-lg:12px; --r-sm:8px;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:400 15px/1.5 var(--sans);
  letter-spacing:-.01em;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:32px clamp(18px,4vw,40px) 80px}
a{color:var(--signal);text-decoration:none}
a:hover{text-decoration:underline}

header{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;
  justify-content:space-between;padding-bottom:20px;border-bottom:1px solid var(--rule)}
h1{font-size:26px;font-weight:600;letter-spacing:-.022em}
.who{font-size:13px;color:var(--ink-3)}
.ranges{display:flex;gap:6px;margin:22px 0 26px}
.range{font:500 13px var(--sans);padding:6px 14px;border:1px solid var(--rule-2);
  border-radius:var(--r-pill);background:var(--paper-3);color:var(--ink-2);cursor:pointer}
.range[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.range--sep{margin-left:auto}

/* 148px rather than 160px so all six headline figures sit on one row at the
   page's full width. At 160 the sixth wrapped onto a line of its own, which
   read as an afterthought rather than one of the set. */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px;margin-bottom:30px}
.tile{background:var(--paper-3);border:1px solid var(--rule);border-radius:var(--r-lg);padding:16px 18px}
.tile dt{font-size:12px;color:var(--ink-3);letter-spacing:0}
.tile dd{margin-top:6px;font:600 27px/1 var(--sans);letter-spacing:-.028em;
  font-variant-numeric:tabular-nums}
.tile .sub{margin-top:5px;font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}

section{margin-bottom:34px}
h2{font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;
  color:var(--ink-3);margin-bottom:12px}
.card{background:var(--paper-3);border:1px solid var(--rule);border-radius:var(--r-lg);padding:18px}

.legend{display:flex;gap:16px;margin-bottom:10px;font-size:12.5px;color:var(--ink-2)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.swatch{width:9px;height:9px;border-radius:2px;flex:none}

table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:left;font:500 11.5px var(--sans);letter-spacing:.02em;text-transform:uppercase;
  color:var(--ink-3);padding:0 10px 8px 0;border-bottom:1px solid var(--rule)}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--rule);font-size:13.5px;color:var(--ink-2)}
tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;font-family:var(--mono);font-size:12.5px;color:var(--ink)}
/* Only the last column may lose its right padding. A right-aligned number in
   the middle of a row butts straight into the next cell's text without it --
   which is how "Demos" and "Last seen" came out as one word. */
td.n:last-child,th.n:last-child{padding-right:0}
.lab{position:relative;color:var(--ink);z-index:0}
/* The magnitude bar sits behind the label rather than in its own column, so a
   long path and a short one still line up and the row stays one line. */
.lab .bar{position:absolute;inset:-3px auto -3px -6px;background:rgba(215,0,21,.10);
  border-radius:3px;z-index:-1}
.mut{color:var(--ink-3)}
#recent td:first-child{white-space:nowrap}
@media (max-width:720px){
  /* Six columns do not fit a phone. Device and page count are the two that
     answer the least, so they are the two that go. */
  /* Seven columns do not fit a phone. Network, device and page count are the
     three that answer the least in a feed whose point is who / what / how long. */
  #recent th:nth-child(3),#recent td:nth-child(3),
  #recent th:nth-child(4),#recent td:nth-child(4),
  #recent th:nth-child(6),#recent td:nth-child(6){display:none}
  #loyal th:nth-child(2),#loyal td:nth-child(2){display:none}
  .wrap{padding-left:16px;padding-right:16px}
  td,th{padding-right:8px}
}
.empty{padding:16px 0;color:var(--ink-3);font-size:13.5px}

/* Comments. Everything here was typed by a stranger, so it is rendered as
   text and never as markup -- see esc() in the client below. */
.cmt{padding:16px 0;border-bottom:1px solid var(--rule)}
.cmt:first-child{padding-top:0}
.cmt:last-child{border-bottom:0;padding-bottom:0}
.cmt__m{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px;color:var(--ink-3);margin-bottom:7px}
.cmt__who{color:var(--ink);font-weight:500}
.cmt__b{font-size:14.5px;line-height:1.55;color:var(--ink-2);white-space:pre-wrap;overflow-wrap:anywhere}
.cmt__c{font-family:var(--mono);font-size:12px}

svg{display:block;width:100%;height:auto;overflow:visible;touch-action:none}
.grid line{stroke:var(--rule);stroke-width:1}
/* Note: a fill="" presentation attribute loses to this rule, so the
   direct labels on the chart set fill through an inline style. */
.ax{font:400 11px var(--mono);fill:var(--ink-3)}
.dot{r:4}
.cross{stroke:var(--rule-2);stroke-width:1;stroke-dasharray:3 3}
.tip{position:absolute;pointer-events:none;background:var(--ink);color:#fff;font-size:12px;
  padding:7px 10px;border-radius:var(--r-sm);white-space:nowrap;opacity:0;transition:opacity .12s;
  font-variant-numeric:tabular-nums;z-index:5}
.plot{position:relative}

.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--rule);
  font-size:12px;color:var(--ink-3);line-height:1.7}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export function signedOut() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Sign in</title><style>${SHELL}
.gate{min-height:100vh;display:grid;place-items:center;padding:24px}
.gate .box{max-width:420px;text-align:center}
.gate p{color:var(--ink-3);font-size:14px;margin-top:10px}
.btn{display:inline-block;margin-top:22px;background:var(--ink);color:#fff;
  border-radius:var(--r-pill);padding:11px 22px;font-weight:500;font-size:15px}
.btn:hover{text-decoration:none;opacity:.88}
</style></head><body><div class="gate"><div class="box">
<h1>Traffic</h1>
<p>This dashboard is for one GitHub account. Everyone else gets this page.</p>
<a class="btn" href="/login">Sign in with GitHub</a>
</div></div></body></html>`;
}

export function dashboard(admin) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Traffic</title><style>${SHELL}</style></head><body><div class="wrap">
<header>
  <h1>Traffic</h1>
  <p class="who">${esc(admin.login)} &middot; <a href="/logout">sign out</a></p>
</header>

<div class="ranges" role="group" aria-label="Time range">
  <button class="range" data-days="7">7 days</button>
  <button class="range" data-days="30" aria-pressed="true">30 days</button>
  <button class="range" data-days="90">90 days</button>
  <button class="range" data-days="all">All time</button>
  <button class="range range--sep" id="bots" aria-pressed="false">Include crawlers</button>
</div>

<dl class="tiles" id="tiles"></dl>

<section><h2>Comments</h2><div class="card" id="cmts"></div></section>

<section>
  <h2>Visits over time</h2>
  <div class="card">
    <div class="legend">
      <span><i class="swatch" style="background:#d70015"></i>Visits</span>
      <span><i class="swatch" style="background:#007a3d"></i>Unique visitors</span>
    </div>
    <div class="plot"><div class="tip" id="tip"></div><div id="chart"></div></div>
  </div>
</section>

<section><h2>Demos</h2><div class="card" id="demos"></div></section>
<section><h2>Pages</h2><div class="card" id="pages"></div></section>
<section><h2>Where from</h2><div class="card" id="places"></div></section>
<section><h2>How they arrived</h2><div class="card" id="refs"></div></section>
<section><h2>Networks</h2><div class="card" id="orgs"></div></section>
<section><h2>Crawlers, excluded from the numbers above</h2><div class="card" id="crawlers"></div></section>
<section><h2>Links out</h2><div class="card" id="outbound"></div></section>
<section><h2>Regulars</h2><div class="card" id="loyal"></div></section>
<section><h2>Recent sessions</h2><div class="card" id="recent"></div></section>

<p class="foot">
  No IP addresses, user-agent strings, referrers or cookies are stored. A visitor is
  a one-way hash of an address and a browser against a secret salt &mdash; the address
  itself is never written down, and without the salt nobody can test a given address
  against this table. The hash no longer rotates daily, which is what makes
  <em>Returning</em> and <em>Regulars</em> answerable at all: the same reader is
  recognisable across months. That is a persistent pseudonymous identifier, which is
  tracking in the ordinary sense of the word, and the site says so. It changes when
  someone changes network or browser, so it drifts and undercounts rather than over-counts.
  <br><br>
  <em>Networks</em> is the organisation a request arrived over, which Cloudflare
  resolves at the edge &mdash; a university, an employer, or an internet provider.
  It is the question a raw address is usually wanted for, answered without keeping
  anything that points at a person.
  <br><br>
  Everything above excludes crawlers unless you ask for them: something that
  named itself a bot in its user-agent, that Cloudflare verified as one, or that
  arrived over a hosting network. The last of those cannot tell a link scanner
  from somebody reading this at work, so nothing is deleted on the strength of it
  and the excluded rows stay listed with their reason. Times are in
  <em id="tzn"></em>; the day buckets in the chart are UTC, because that grouping
  happens in the database.
  <br><br>
  Nothing is ever deleted. A visit is a session; a bounce is one page with no demo and
  no outbound click. A demo is <em>opened</em> when a reader touches it and
  <em>engaged</em> once it has held a visible screen for five seconds after that, so
  scrolling past six sections on the way down the page is not six demos. All times are
  engaged time: a tab left open contributes nothing.
</p>
</div>
<script>${CLIENT}</script></body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CLIENT = String.raw`
var RED = "#d70015", GREEN = "#007a3d", days = 30, bots = 0;

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function n(v){return (v==null?0:v).toLocaleString("en-US");}
function pct(v){return v==null?"--":(v*100).toFixed(0)+"%";}
/* Rendered in whatever zone this browser is in, because the only person who
   ever loads this page is reading it from one place. It used to print UTC,
   which made an evening of browsing look like it happened at four in the
   morning. Day buckets in the chart are still UTC -- that grouping happens in
   SQL -- so the axis says so. */
var TZ=(function(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"local";}catch(e){return "local";}})();
function when(ts){
  var d=new Date(ts);
  try{
    return d.toLocaleString(undefined,{month:"short",day:"numeric",
      hour:"2-digit",minute:"2-digit",hour12:false});
  }catch(e){ return d.toISOString().slice(5,16).replace("T"," "); }
}
function dayOf(ts){
  var d=new Date(ts);
  try{ return d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}); }
  catch(e){ return d.toISOString().slice(0,10); }
}
function dur(ms){
  if(!ms) return "--";
  var s=Math.round(ms/1000);
  if(s<60) return s+"s";
  var m=Math.floor(s/60); return m+"m "+String(s%60).padStart(2,"0")+"s";
}
function flag(cc){
  // Regional-indicator maths: two ASCII letters map to the flag codepoints.
  if(!cc||cc.length!==2||!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(0x1F1E6+cc.charCodeAt(0)-65, 0x1F1E6+cc.charCodeAt(1)-65);
}

/* A table with the magnitude drawn behind the label. Rows are already sorted
   by the query; the bar is scaled to the largest value present so the shape of
   the distribution is visible even when every number is small. */
function table(cols, rows, barKey){
  if(!rows.length) return '<p class="empty">Nothing recorded in this window.</p>';
  var max = barKey ? Math.max.apply(null, rows.map(function(r){return r[barKey]||0;})) : 0;
  var head = cols.map(function(c){
    return '<th class="'+(c.n?"n":"")+'">'+esc(c.h)+"</th>";}).join("");
  var body = rows.map(function(r){
    return "<tr>"+cols.map(function(c,i){
      var v = c.get(r);
      if(i===0 && barKey && max>0){
        var w = Math.max(1.5,(r[barKey]||0)/max*100);
        return '<td class="lab"><span class="bar" style="width:calc('+w+'% + 6px)"></span>'+v+"</td>";
      }
      return '<td class="'+(c.n?"n":"")+'">'+v+"</td>";
    }).join("")+"</tr>";}).join("");
  return "<table><thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody></table>";
}

/* Two series, one axis, both counts of the same kind of thing -- never a second
   y-scale. Direct labels at the right end carry identity alongside the legend,
   so the pair does not rely on colour alone. */
function chart(series){
  var host=document.getElementById("chart"), tip=document.getElementById("tip");
  if(!series.length){host.innerHTML='<p class="empty">Nothing recorded in this window.</p>';return;}
  var W=920,H=240,L=44,R=68,T=14,B=26, iw=W-L-R, ih=H-T-B;
  var max=Math.max(4,Math.max.apply(null,series.map(function(d){return Math.max(d.visits,d.visitors);})));
  var step=Math.pow(10,Math.floor(Math.log10(max)));var top=Math.ceil(max/step)*step;
  var x=function(i){return L+(series.length<2?iw/2:i/(series.length-1)*iw);};
  var y=function(v){return T+ih-(v/top)*ih;};
  var line=function(k){return series.map(function(d,i){return (i?"L":"M")+x(i).toFixed(1)+" "+y(d[k]).toFixed(1);}).join(" ");};

  var ticks="",gl="";
  for(var t=0;t<=4;t++){
    var v=top*t/4, yy=y(v);
    gl+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy.toFixed(1)+'" y2="'+yy.toFixed(1)+'"/>';
    ticks+='<text class="ax" x="'+(L-9)+'" y="'+(yy+4).toFixed(1)+'" text-anchor="end">'+n(Math.round(v))+"</text>";
  }
  var first=series[0].day.slice(5), last=series[series.length-1].day.slice(5);
  ticks+='<text class="ax" x="'+L+'" y="'+(H-6)+'">'+first+"</text>";
  if(series.length>1) ticks+='<text class="ax" x="'+(W-R)+'" y="'+(H-6)+'" text-anchor="end">'+last+"</text>";

  // Direct labels at the right end, nudged apart when the two series finish
  // close together -- which on this data is most days, and stacked glyphs read
  // as one wrong number rather than two right ones.
  var e=series[series.length-1];
  var ly1=y(e.visits), ly2=y(e.visitors), GAP=13;
  if(Math.abs(ly1-ly2)<GAP){
    var mid=(ly1+ly2)/2, up=ly1<=ly2?-1:1;
    ly1=mid+up*GAP/2; ly2=mid-up*GAP/2;
  }
  var lab='<text class="ax" x="'+(W-R+10)+'" y="'+(ly1+4).toFixed(1)+'" style="fill:'+RED+'">'+n(e.visits)+"</text>"+
          '<text class="ax" x="'+(W-R+10)+'" y="'+(ly2+4).toFixed(1)+'" style="fill:'+GREEN+'">'+n(e.visitors)+"</text>";

  host.innerHTML='<svg viewBox="0 0 '+W+" "+H+'" role="img" aria-label="Visits and unique visitors per day">'+
    '<g class="grid">'+gl+"</g>"+ticks+
    '<path d="'+line("visits")+'" fill="none" stroke="'+RED+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<path d="'+line("visitors")+'" fill="none" stroke="'+GREEN+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
    lab+'<line class="cross" id="cx" y1="'+T+'" y2="'+(T+ih)+'" style="display:none"/>'+
    '<circle class="dot" id="d1" fill="'+RED+'" stroke="#fff" stroke-width="2" style="display:none"/>'+
    '<circle class="dot" id="d2" fill="'+GREEN+'" stroke="#fff" stroke-width="2" style="display:none"/>'+
    '<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent" id="hit"/></svg>';

  var svg=host.querySelector("svg"), cx=host.querySelector("#cx"),
      d1=host.querySelector("#d1"), d2=host.querySelector("#d2");
  function move(ev){
    var b=svg.getBoundingClientRect();
    var px=(ev.clientX-b.left)/b.width*W;
    var i=Math.round((px-L)/(iw||1)*(series.length-1));
    i=Math.max(0,Math.min(series.length-1,i));
    var d=series[i];
    cx.setAttribute("x1",x(i));cx.setAttribute("x2",x(i));cx.style.display="";
    d1.setAttribute("cx",x(i));d1.setAttribute("cy",y(d.visits));d1.style.display="";
    d2.setAttribute("cx",x(i));d2.setAttribute("cy",y(d.visitors));d2.style.display="";
    tip.innerHTML=esc(d.day)+" &middot; "+n(d.visits)+" visits &middot; "+n(d.visitors)+" visitors";
    tip.style.opacity="1";
    var left=x(i)/W*b.width;
    tip.style.left=Math.min(Math.max(0,left-tip.offsetWidth/2),b.width-tip.offsetWidth)+"px";
    tip.style.top="-6px";
  }
  svg.addEventListener("pointermove",move);
  svg.addEventListener("pointerleave",function(){
    tip.style.opacity="0";cx.style.display="none";d1.style.display="none";d2.style.display="none";});
}

function render(s){
  var t=s.totals;
  var w=s.window;
  var span = w.all
    ? (w.first ? "everything since "+w.first : "no data yet")
    : "sessions in "+w.days+" days";
  document.getElementById("tiles").innerHTML=[
    ["Visits",n(t.visits),span],
    ["Unique visitors",n(t.visitors),n(w.visitorsEver)+" ever, across "+n(w.daysWithData)+" days"],
    ["Returning",n(t.returning),"here on more than one day"],
    ["Pages read",n(t.views),""],
    ["Median time",dur(t.medianDwellMs),"engaged, not tab-open"],
    ["Bounce",pct(t.bounceRate),"one page, nothing else"]
  ].map(function(r){
    return '<div class="tile"><dt>'+esc(r[0])+"</dt><dd>"+r[1]+"</dd>"+
      (r[2]?'<div class="sub">'+esc(r[2])+"</div>":"")+"</div>";}).join("");

  chart(s.series);

  document.getElementById("demos").innerHTML=table([
    {h:"Demo",get:function(r){return esc(r.label);}},
    {h:"Opened",n:1,get:function(r){return n(r.starts);}},
    {h:"Engaged",n:1,get:function(r){return n(r.dones);}},
    {h:"Rate",n:1,get:function(r){return pct(r.completion);}},
    {h:"Avg time",n:1,get:function(r){return dur(r.avg_ms);}}
  ],s.demos,"starts");

  document.getElementById("pages").innerHTML=table([
    {h:"Path",get:function(r){return esc(r.path);}},
    {h:"Views",n:1,get:function(r){return n(r.views);}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}}
  ],s.pages,"views");

  document.getElementById("places").innerHTML=table([
    {h:"Place",get:function(r){
      var f=flag(r.country);
      return (f?f+" ":"")+esc(r.city||r.country||"unknown")+
        (r.city&&r.country?' <span class="mut">'+esc(r.country)+"</span>":"");}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}}
  ],s.places,"visits");

  document.getElementById("refs").innerHTML=table([
    {h:"From",get:function(r){return esc(r.ref);}},
    {h:"Views",n:1,get:function(r){return n(r.views);}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}}
  ],s.refs||[],"views");

  document.getElementById("crawlers").innerHTML=table([
    {h:"Network",get:function(r){return esc(r.org);}},
    {h:"Why",get:function(r){return esc({agent:"said so in its user-agent",
      verified:"verified by Cloudflare",hosting:"came over a hosting network"}[r.why]||r.why);}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}},
    {h:"Demos",n:1,get:function(r){return n(r.demos);}},
    {h:"Last seen",get:function(r){return esc(when(r.last_ts));}}
  ],s.crawlers||[],"visits");

  document.getElementById("orgs").innerHTML=table([
    {h:"Network",get:function(r){return esc(r.org);}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}},
    {h:"People",n:1,get:function(r){return n(r.visitors);}}
  ],s.orgs||[],"visits");

  document.getElementById("outbound").innerHTML=table([
    {h:"Destination",get:function(r){return esc(r.label);}},
    {h:"Clicks",n:1,get:function(r){return n(r.clicks);}},
    {h:"Visits",n:1,get:function(r){return n(r.sessions);}}
  ],s.outbound,"clicks");

  document.getElementById("loyal").innerHTML=table([
    {h:"Where",get:function(r){
      var f=flag(r.country);return (f?f+" ":"")+esc(r.city||r.country||"unknown");}},
    {h:"Network",get:function(r){return r.org?esc(r.org):'<span class="mut">--</span>';}},
    {h:"Days",n:1,get:function(r){return n(r.days);}},
    {h:"Visits",n:1,get:function(r){return n(r.visits);}},
    {h:"Demos",n:1,get:function(r){return n(r.demos);}},
    {h:"First",get:function(r){return esc(dayOf(r.first_ts));}},
    {h:"Last",get:function(r){return esc(dayOf(r.last_ts));}}
  ],s.loyal||[],"days");

  document.getElementById("recent").innerHTML=table([
    {h:"When",get:function(r){return esc(when(r.started));}},
    {h:"Where",get:function(r){
      var f=flag(r.country);return (f?f+" ":"")+esc(r.city||r.country||"unknown");}},
    {h:"Network",get:function(r){return r.org?esc(r.org):'<span class="mut">--</span>';}},
    {h:"On",get:function(r){return esc(r.device||"");}},
    {h:"Ran",get:function(r){return r.ran.length?esc(r.ran.join(", ")):'<span class="mut">--</span>';}},
    {h:"Pages",n:1,get:function(r){return n(r.views);}},
    {h:"Stayed",n:1,get:function(r){return dur(r.ms);}}
  ],s.recent,null);
}

/* Comments are rendered as text, never as markup. esc() runs over every field
   including the body, and the body keeps its line breaks through CSS rather
   than through <br>, so there is no path from what someone typed into this
   page's DOM. This is the one place on the dashboard where getting that wrong
   would matter: it is the privileged session. */
function renderComments(list){
  var host=document.getElementById("cmts");
  if(!list||!list.length){
    host.innerHTML='<p class="empty">Nobody has written anything yet.</p>';return;}
  host.innerHTML=list.map(function(c){
    var at=when(c.ts);
    var f=flag(c.country);
    var bits=[];
    bits.push('<span class="cmt__who">'+esc(c.name||"Anonymous")+"</span>");
    if(c.contact) bits.push('<a class="cmt__c" href="mailto:'+esc(c.contact)+'">'+esc(c.contact)+"</a>");
    bits.push(esc(at));
    bits.push((f?f+" ":"")+esc(c.city||c.country||"unknown"));
    if(c.org) bits.push(esc(c.org));
    if(c.path) bits.push(esc(c.path));
    if(c.visitor_days>1) bits.push(esc(c.visitor_days+" days here"));
    if(c.visitor_demos>0) bits.push(esc(c.visitor_demos+" demos run"));
    return '<div class="cmt"><div class="cmt__m">'+bits.join("<span>&middot;</span>")+"</div>"+
           '<div class="cmt__b">'+esc(c.body)+"</div></div>";
  }).join("");
}

function load(){
  fetch("/api/stats?days="+days+"&bots="+bots,{credentials:"same-origin",cache:"no-store"})
    .then(function(r){ if(r.status===401){location.href="/";return null;}
      return r.ok?r.json():Promise.reject(r.status);})
    .then(function(s){ if(s) render(s); })
    .catch(function(e){
      document.getElementById("tiles").innerHTML=
        '<p class="empty">Could not load the numbers ('+esc(e)+').</p>';});

  // Its own request, and its own failure: comments are the thing most worth
  // seeing, and a broken chart query should not take them down with it.
  fetch("/api/comments?limit=200",{credentials:"same-origin",cache:"no-store"})
    .then(function(r){ return r.ok?r.json():Promise.reject(r.status);})
    .then(renderComments)
    .catch(function(e){
      document.getElementById("cmts").innerHTML=
        '<p class="empty">Could not load the comments ('+esc(e)+').</p>';});
}

document.querySelectorAll(".range[data-days]").forEach(function(b){
  b.addEventListener("click",function(){
    document.querySelectorAll(".range[data-days]").forEach(function(o){o.removeAttribute("aria-pressed");});
    b.setAttribute("aria-pressed","true");
    days=b.dataset.days; load();
  });
});
document.getElementById("bots").addEventListener("click",function(){
  bots=bots?0:1;
  this.setAttribute("aria-pressed",bots?"true":"false");
  load();
});
var tzn=document.getElementById("tzn"); if(tzn) tzn.textContent=TZ;
load();
`;
