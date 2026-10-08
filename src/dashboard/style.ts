/** CSS i dashboard-it (shërbehet si /style.css; CSP lejon vetëm stile nga 'self'). */
export const STYLE = `
:root{--bg:#f4f5f1;--panel:#fff;--text:#16252a;--muted:#55646a;--line:#e0e5e2;--accent:#1b6a56;--accent-soft:#e7f1ed;
--crit:#b3261e;--high:#b4430f;--med:#8f5a06;--low:#3f6382;--ok:#1d7448;--warn:#8f5a06;--info:#3f6382;
--chip:#edf1ee;--code:#f1f3f0;--shadow:0 1px 2px rgba(16,40,36,.06);
--side:#12323a;--side-2:#1b4049;--side-text:#e4eeec;--side-muted:#a9c0bc;--bar:#e3e8e5;--bar-ok:#2e9a73;--bar-warn:#d99a3e}
@media (prefers-color-scheme:dark){:root{--bg:#0e1618;--panel:#152125;--text:#e3ece9;--muted:#9fb3af;--line:#26363a;
--accent:#6fd0b3;--accent-soft:#1c3330;--crit:#ff8a80;--high:#ffab70;--med:#e5c07b;--low:#9cb4cc;--ok:#6fcf97;--warn:#e5c07b;--info:#9cb4cc;
--chip:#1d2b2f;--code:#1a272a;--shadow:none;--side:#0b2227;--side-2:#163238;--bar:#26363a}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
.skip{position:absolute;left:-9999px;top:8px;background:var(--panel);color:var(--accent);padding:8px 12px;border-radius:6px;z-index:10}
.skip:focus{left:12px}
.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--side) 236px,transparent 236px)}
aside.side{background:var(--side);color:var(--side-text);padding:20px 14px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;height:100vh;overflow-y:auto}
aside.side .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;padding:2px 8px 16px;color:var(--side-text);text-decoration:none}
aside.side .logo{width:30px;height:30px;border-radius:50%;background:#3fbf93;color:#0b2a24;display:grid;place-items:center;font-size:16px;font-weight:800}
aside.side .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--side-muted);padding:6px 10px}
aside.side nav{display:flex;flex-direction:column;gap:2px}
aside.side nav a{color:var(--side-text);text-decoration:none;padding:9px 12px;border-radius:8px;font-size:15px}
aside.side nav a:hover{background:var(--side-2)}
aside.side nav a[aria-current="page"]{background:var(--side-2);font-weight:650;box-shadow:inset 3px 0 0 #3fbf93}
aside.side hr{border:0;border-top:1px solid var(--side-2);margin:10px 8px}
aside.side .local{margin-top:auto;font-size:13px;color:var(--side-text)}
aside.side .local>summary{cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;color:var(--side-muted);font-weight:600;list-style:none}
aside.side .local>summary::-webkit-details-marker{display:none}
aside.side .local>summary:hover{color:var(--side-text);background:var(--side-2)}
aside.side .local .ldot{width:8px;height:8px;border-radius:50%;background:#3fbf93}
aside.side .local p{margin:6px 0 0;padding:10px 12px;border-radius:8px;background:var(--side-2);line-height:1.45;font-size:12.5px}
aside.side :focus-visible{outline-color:#8fe3c7}
main{max-width:1180px;width:100%;margin:0 auto;padding:22px 28px 60px;min-width:0}
@media (max-width:900px){.shell{display:block;background:none}aside.side{position:static;height:auto;padding:12px;gap:4px}
aside.side .brand{padding:0 4px 8px;font-size:16px}aside.side .label,aside.side hr{display:none}

aside.side>.local{display:none}main{padding:14px 14px 48px}}
h1{font-size:22px;margin:4px 0 4px}h2{font-size:17px;margin:0 0 10px}h3{font-size:15px;margin:14px 0 6px}
.sub{color:var(--muted);font-size:13px}
.panel{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:14px 0;box-shadow:var(--shadow)}
.panel.scope{border-left:4px solid var(--accent)}
.panel.signals{border-left:4px solid var(--info)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
td.nowrap{white-space:nowrap}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--chip);white-space:nowrap}
.b-complete,.b-pass,.b-improved{color:var(--ok)}.b-partial,.b-warning,.b-noise,.b-measured-increase,.b-measured-decrease{color:var(--warn)}
.b-fail,.b-worsened{color:var(--crit)}.b-skipped,.b-not-comparable,.b-unknown,.b-info,.b-same,.b-inconclusive{color:var(--muted)}
.sev-critical{color:var(--crit)}.sev-high{color:var(--high)}.sev-medium{color:var(--med)}.sev-low{color:var(--low)}
.score{font-size:40px;font-weight:700;line-height:1}
.score small{font-size:14px;color:var(--muted);font-weight:500}
.kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 14px;font-size:14px}.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
details.issue{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--panel)}
details.issue>summary{cursor:pointer;padding:9px 12px 9px 28px;list-style:none;position:relative;line-height:1.7}
details.issue>summary>*{margin-right:8px}
details.issue>summary::-webkit-details-marker{display:none}
details.issue>summary::before{content:"▸";color:var(--muted);position:absolute;left:11px}details.issue[open]>summary::before{content:"▾"}
details.gallery>summary{cursor:pointer;font-weight:600;margin:12px 0 6px}
details.issue .body{padding:4px 14px 12px;border-top:1px solid var(--line)}
.code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--muted)}
pre,.ev{background:var(--code);border-radius:6px;padding:8px 10px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:6px 0;max-height:260px;overflow:auto}
.ev b{font-family:system-ui,sans-serif}
ul.plain{margin:6px 0;padding-left:18px}
form.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:6px 0 10px}
form.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:3px}
select,button{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);max-width:min(420px,100%)}
form.filters input{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:5px 8px;max-width:100%}
button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}
label.field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);margin:8px 0}
label.field textarea{font:12px/1.4 ui-monospace,Consolas,monospace;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 9px;width:100%}
a.button{display:inline-block;background:var(--accent);color:#fff;border-radius:6px;padding:8px 14px;text-decoration:none;font-weight:600}
ol.steps{padding-left:22px}ol.steps li{margin:4px 0}
label.field input{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 9px;width:100%}
.row{display:flex;gap:12px}.row label.field{flex:1}
label.check{display:block;font-size:14px;margin:5px 0}label.check input{margin-right:6px}
button:disabled{opacity:.5;cursor:not-allowed}button.danger{background:var(--crit);border-color:var(--crit)}
.bigpath{font-size:15px;background:var(--code);padding:10px 12px;border-radius:8px;word-break:break-all;color:var(--text)}
.grid.forms{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start}
.errors{border-left:3px solid var(--crit)}
a{color:var(--accent)}a.ext::after{content:" ↗";font-size:11px}
.shots{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}
.shot{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--code);width:220px}
.shot img{display:block;width:100%;height:220px;object-fit:cover;object-position:top}
.shot.mobile{width:120px}.shot figcaption{font-size:12px;color:var(--muted);padding:5px 8px}
.note{font-size:13px;color:var(--muted)}
.warnbox{background:var(--chip);border-radius:8px;padding:8px 12px;font-size:13px;margin:8px 0}
.muted{color:var(--muted)}
.row-actions a{margin-right:10px;white-space:nowrap}
div.row-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:6px 0}
form.inline{display:inline;margin:0}button.secondary{background:var(--panel);color:var(--accent)}
ul.cols{columns:2 320px;column-gap:24px}ul.cols li{break-inside:avoid}
nav.quick{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px}
.shot.none{display:flex;flex-direction:column}.shot .ph{height:220px;padding:10px;font-size:12px;color:var(--warn);overflow:auto}
.shot.mobile .ph{height:220px}.miss{color:var(--warn)}.tag{font-size:11px;color:var(--accent);font-weight:600}
.viewer{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start}
.viewer .big{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:85vh;overflow:auto}
.viewer .big img{display:block;max-width:100%;height:auto;margin:0 auto}.viewer .big.mobile img{max-width:430px;width:100%}
.viewer .meta .kv{grid-template-columns:max-content minmax(0,1fr)}.pager{display:flex;gap:16px}
.cmp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.cmp-grid.mobile{grid-template-columns:repeat(2,minmax(0,430px))}
figure.cmp{margin:0;border:1px solid var(--line);border-radius:8px;background:var(--code);overflow:hidden}figure.cmp figcaption{font-size:12px;color:var(--muted);padding:5px 8px}
figure.cmp img{display:block;width:100%;height:auto;max-height:80vh;object-fit:cover;object-position:top}
.ovl{position:relative;border:1px solid var(--line);border-radius:8px;overflow-x:hidden;overflow-y:auto;max-height:60vh;background:#000}.ovl.mobile{max-width:430px}
.ovl img{display:block;width:100%;height:auto}.ovl img.top{position:absolute;top:0;left:0;mix-blend-mode:difference}
@media (max-width:900px){.viewer{grid-template-columns:1fr}.cmp-grid,.cmp-grid.mobile{grid-template-columns:1fr}}
@media (max-width:700px){main{padding:12px}.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}.ev,pre{max-width:calc(100vw - 60px)}header.top{padding:10px 12px}table:not(.keep) th:nth-child(n+6),table:not(.keep) td:nth-child(n+6){display:none}form.filters label,form.filters select,form.filters input{width:100%}}
/* Faza 5: gjendjet, kartat e totalit, tabelat e gjata, fokusi nga tastiera */
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
details>summary:focus-visible{outline-offset:-3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
p.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:8px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;box-shadow:var(--shadow)}
.card .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.card .v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.25}.card .v.none{font-size:14px;font-weight:600;color:var(--warn)}
h2.cards-title{margin:14px 0 0}.code.big{font-size:inherit;color:var(--text)}
.tablewrap{overflow-x:auto;max-width:100%;position:relative}td.url{overflow-wrap:anywhere;min-width:12ch}tr.sum td{font-weight:650}
details.panel>summary{cursor:pointer;list-style:none}details.panel>summary::-webkit-details-marker{display:none}
details.panel>summary h2{display:inline;margin:0}details.panel>summary::before{content:"▸ ";color:var(--muted)}details.panel[open]>summary::before{content:"▾ "}
details.panel[open]>summary{margin-bottom:10px}
details.setup>summary{cursor:pointer;list-style:none}details.setup>summary::-webkit-details-marker{display:none}details.setup>summary h2{display:inline}
nav.pager{display:flex;gap:16px;align-items:center;margin-top:8px;flex-wrap:wrap}
p.counts strong{color:var(--text)}
@media (max-width:700px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.card .v{font-size:20px}.tablewrap>table:not(.cardify){min-width:560px}.tablewrap{border:1px solid var(--line);border-radius:6px}}
/* Faza 6: ridizajni (shiriti anësor, përmbledhja, kartat me hierarki) */
h1{font-size:30px;line-height:1.2;margin:2px 0 6px;letter-spacing:-.01em}h2{font-size:18px}
.panel{border-radius:14px;padding:18px 22px}
.badge{border-radius:6px;padding:1px 8px}
.crumb{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.crumb a{color:inherit}
a.btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;text-decoration:none;font-weight:650;padding:10px 18px;border-radius:10px}
a.btn.ghost{background:var(--panel);color:var(--accent);border:1px solid var(--line)}
@media (prefers-color-scheme:dark){a.btn{color:#0b2a24}}
.meter{height:8px;border-radius:99px;background:var(--bar);overflow:hidden;margin:8px 0 8px;max-width:240px}
.meter i{display:block;height:100%;background:var(--bar-ok);border-radius:99px}
.meter i.warn{background:var(--bar-warn)}
.more{display:inline-block;margin-top:14px;font-weight:650;color:var(--accent);text-decoration:none}
.ptable td,.ptable th{padding:9px 6px}
ul.dots{list-style:none;padding:0;margin:4px 0}ul.dots li{padding:6px 0 6px 22px;position:relative;font-size:14px}
ul.dots li::before{content:"";position:absolute;left:4px;top:13px;width:9px;height:9px;border-radius:50%;background:var(--bar-ok)}
ul.dots li.warn::before{background:var(--bar-warn)}ul.dots li.info::before{background:var(--info)}
.lhgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}
.lh{border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.lh .k{font-size:12px;color:var(--muted);font-weight:650}.lh .v{font-size:24px;font-weight:750;font-variant-numeric:tabular-nums}
.lh .v small{font-size:13px;color:var(--muted);font-weight:600}.lh.exp{border-style:dashed}
.lh .v.none{font-size:14px;color:var(--muted);font-weight:600;padding:6px 0}
/* gjerësitë e shiritave pa style inline (CSP style-src self) */
.meter i.w0{width:0%}.meter i.w5{width:5%}.meter i.w10{width:10%}.meter i.w15{width:15%}.meter i.w20{width:20%}.meter i.w25{width:25%}.meter i.w30{width:30%}.meter i.w35{width:35%}.meter i.w40{width:40%}.meter i.w45{width:45%}.meter i.w50{width:50%}.meter i.w55{width:55%}.meter i.w60{width:60%}.meter i.w65{width:65%}.meter i.w70{width:70%}.meter i.w75{width:75%}.meter i.w80{width:80%}.meter i.w85{width:85%}.meter i.w90{width:90%}.meter i.w95{width:95%}.meter i.w100{width:100%}
/* Tabelat e Search Console në ekran të ngushtë: çdo rresht bëhet kartë, vlerat me etiketë (data-label), pa lëvizje anash */
@media (max-width:700px){
.tablewrap>table.cardify{min-width:0}
.tablewrap:has(>table.cardify){border:0;overflow:visible}
table.cardify,table.cardify tbody,table.cardify tr,table.cardify td{display:block;width:100%}
table.cardify thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
table.cardify tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 10px;background:var(--panel)}
table.cardify td{border:0;padding:0;text-align:left;min-width:0}
table.cardify td:first-child,table.cardify td.lead,table.cardify td.url[data-label],table.cardify td.wide{grid-column:1/-1}
table.cardify td:first-child,table.cardify td.lead{font-weight:650;overflow-wrap:anywhere}
table.cardify td[data-label]::before{content:attr(data-label);display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
table.cardify td.num{font-size:16px;font-variant-numeric:tabular-nums}
table.cardify tr.sum{background:var(--accent-soft)}
}
/* Veprimet dhe zona e fshirjes (GSC): të ndara qartë, me konfirmim në faqe më vete */
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0 4px}
.actions form.inline{display:inline-flex}
.panel.danger{border-left:4px solid var(--crit)}
ul.danger-list{list-style:none;margin:0;padding:0}
ul.danger-list li{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-top:1px solid var(--line)}
a.btn.danger-ghost{background:var(--panel);color:var(--crit);border:1px solid var(--crit);white-space:nowrap}
button.danger,a.btn.danger{background:var(--crit);border-color:var(--crit);color:#fff}
@media (max-width:700px){ul.danger-list li{flex-direction:column;align-items:stretch;gap:10px;padding:16px 0}
ul.danger-list a.btn{justify-content:center}
.actions{flex-direction:column;align-items:stretch}.actions .btn,.actions button{width:100%;justify-content:center}}
/* Navigimi në ekran të ngushtë: një rresht (marka + "Menu · faqja aktuale"), lista hapet me <details> (pa JS) */
.mnav-btn{display:none}
@media (max-width:900px){
aside.side{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;padding:8px 12px;overflow:visible;position:relative;z-index:30}
.mnav-btn{display:inline-flex}
aside.side .brand{padding:0;font-size:16px}aside.side .logo{width:26px;height:26px;font-size:14px}
aside.side nav.desk,aside.side hr,aside.side .label,aside.side>.local{display:none}
}
/* Përmbledhja: koka kompakte, katër tregues me fushën e tyre, detyrat si listë, kërkimet si tabelë */
.ovhead{display:flex;justify-content:space-between;align-items:flex-end;gap:12px 20px;flex-wrap:wrap;margin:0 0 14px}
.ovhead .crumb{margin:0 0 2px}.ovhead h1{margin:0 0 2px}
.ovmeta{margin:0;font-size:14px;color:var(--muted)}.ovmeta strong{color:var(--text);font-weight:600}
.ovmeta a{font-weight:650;color:var(--accent)}
.ovmeta .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--bar-ok);margin-right:7px;vertical-align:1px}
.ovmeta .dot.warn{background:var(--bar-warn)}
.ovact{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ovact .sitepick{align-items:center}.ovact .sitepick label{font-size:13px;color:var(--muted);flex-direction:row}
.ovact select{min-height:38px}.ovact a.btn{padding:9px 16px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.kpi-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 8px}
.kpi h2{font-size:14px;font-weight:650;margin:0;color:var(--text)}
.kpi .scope{font-size:12px;font-weight:600;padding:1px 8px;border-radius:6px;background:var(--chip);color:var(--muted);white-space:nowrap}
.kpi .scope.warn{background:transparent;color:var(--warn);box-shadow:inset 0 0 0 1px var(--warn)}
.kpi .v{font-size:32px;font-weight:750;line-height:1.1;margin:8px 0 4px;font-variant-numeric:tabular-nums}
.kpi .v small{font-size:15px;font-weight:600;color:var(--muted);margin-left:2px}
.kpi .v.none{font-size:16px;font-weight:650;color:var(--warn);margin:12px 0 6px}
.kpi .d{font-size:13.5px;margin:0;color:var(--text)}.kpi .d2{font-size:12.5px;margin:2px 0 0;color:var(--muted)}
.kpi .meter{max-width:none;margin:6px 0 8px}
.split{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}
.split.even{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.split>.panel{margin:0}
.split+.split{margin-top:16px}
.panel h2+.hint,.panel .hint{font-size:13px;color:var(--muted);margin:-6px 0 10px}
ol.focus{list-style:none;margin:0;padding:0}
ol.focus>li{padding:12px 0;border-top:1px solid var(--line)}
ol.focus>li:first-child{border-top:0;padding-top:4px}
.frow{display:flex;gap:10px;align-items:baseline}
.frow .badge{flex:none}
.frow a.t{font-weight:650;color:var(--text);text-decoration:none}
.frow a.t:hover{text-decoration:underline;color:var(--accent)}
.fact{margin:3px 0 0;font-size:13.5px;color:var(--muted)}
details.fdet{margin:6px 0 0;font-size:13px}
details.fdet>summary{cursor:pointer;color:var(--accent);font-weight:600;width:max-content;max-width:100%}
details.fdet>summary .n{color:var(--muted);font-weight:500}
details.fdet[open]{background:var(--code);border-radius:8px;padding:8px 12px}
details.fdet ul.plain{margin:6px 0;padding-left:18px;list-style:disc}
table.qtable{width:100%;border-collapse:collapse;font-size:14px}
table.qtable th,table.qtable td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
table.qtable thead th{font-size:12px;font-weight:650;color:var(--muted);text-transform:none;letter-spacing:0;border-bottom:1px solid var(--line)}
table.qtable th,table.lhtable th{text-transform:none;letter-spacing:0}
table.qtable tbody th,table.lhtable tbody th{font-size:14px;color:var(--text)}
table.qtable tbody th{font-weight:600;text-align:left;overflow-wrap:anywhere}
table.qtable td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
table.qtable tr.few td{color:var(--muted)}
table.qtable abbr,table.lhtable abbr{text-decoration:none;cursor:help}
table.lhtable{width:100%;border-collapse:collapse;font-size:14px}
table.lhtable th,table.lhtable td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:baseline}
table.lhtable thead th{font-size:12px;font-weight:650;color:var(--muted)}
table.lhtable tbody th{font-weight:600;text-align:left}
table.lhtable td.num{white-space:nowrap;font-variant-numeric:tabular-nums}table.lhtable td.num strong{font-size:16px}
table.lhtable small{color:var(--muted)}table.lhtable .none{color:var(--muted);font-weight:600}
table.lhtable td.note{font-size:12.5px}
.sitepick{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:0}
.sitepick label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:3px}
.empty{text-align:center;padding:40px 20px}
@media (max-width:1100px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.split,.split.even{grid-template-columns:1fr}}
@media (max-width:700px){.ovhead{align-items:stretch;flex-direction:column;gap:10px;margin-bottom:12px}
.ovact{justify-content:space-between}.ovact .sitepick{flex:1}.ovact select{flex:1;min-width:0}
.kpis{gap:10px}.kpi{padding:12px}.kpi .v{font-size:26px}.kpi .scope{white-space:normal}
h1{font-size:24px}.panel{padding:14px}.panel .hint{font-size:12.5px}
table.lhtable td.note{font-size:12px;min-width:110px}
.tablewrap>table.qtable,.tablewrap>table.lhtable{min-width:0}
.tablewrap:has(>table.qtable),.tablewrap:has(>table.lhtable){border:0;border-radius:0}
table.qtable th,table.qtable td,table.lhtable th,table.lhtable td{padding:7px 5px}
details.panel.list>summary .note{display:block;margin-top:2px}}
@media (max-width:380px){.kpis{grid-template-columns:1fr}}
.mnav-btn{align-items:center;gap:6px;color:var(--side-text);background:var(--side-2);border:0;border-radius:8px;padding:8px 12px;font:inherit;font-size:14px;font-weight:600;min-height:40px;cursor:pointer}
.mnav-btn .cur{font-weight:500;color:var(--side-muted)}
.mnav-btn:focus-visible{outline:3px solid #8fe3c7;outline-offset:2px}
/* Popover (pa JS): Escape dhe klikimi jashtë e mbyllin; ::backdrop e errëson përmbajtjen pas tij */
.mnav[popover]{position:fixed;inset:58px 12px auto auto;margin:0;display:none;flex-direction:column;gap:2px;width:min(280px,calc(100vw - 24px));max-height:calc(100vh - 72px);overflow:auto;background:var(--side);color:var(--side-text);border:1px solid #3fbf93;border-radius:12px;padding:8px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
.mnav[popover]:popover-open{display:flex}
.mnav[popover]::backdrop{background:rgba(6,20,23,.55)}
.mnav a{color:var(--side-text);text-decoration:none;padding:11px 12px;border-radius:8px;font-size:15px}
.mnav a:hover{background:var(--side-2)}
.mnav a[aria-current="page"]{background:var(--side-2);font-weight:650;box-shadow:inset 3px 0 0 #3fbf93}
.mnav a:focus-visible{outline:3px solid #8fe3c7;outline-offset:-3px}
.mnav .local{margin:6px 0 0;border-top:1px solid var(--side-2);padding-top:4px}
/* shfletues pa Popover API: lista shfaqet e hapur poshtë kokës (në ekran të ngushtë) */
@supports not selector(:popover-open){@media (max-width:900px){.mnav[popover]{position:static;display:flex;width:100%;max-height:none;box-shadow:none;border:0}.mnav-btn{display:none}}}
/* Kartat: sqarimi i gjatë në desktop; në ekran të ngushtë kalon te "Sqarim" (details), numri dhe fusha mbeten */
.kmore,.kpi .pshort{display:none}
.kmore{margin:6px 0 0;font-size:12.5px}
.kmore>summary{cursor:pointer;color:var(--accent);font-weight:600;width:max-content}
.kmore p{margin:6px 0 0;color:var(--muted);line-height:1.45}
/* Provat te detajet: faqja si titull i vogël, çdo provë një bllok kodi i plotë (thyhet te hapësirat, lëviz brenda bllokut) */
details.fdet p.orig{margin:6px 0;color:var(--muted)}
.fev{margin:8px 0 10px}
.fev-page{margin:0 0 4px;font-weight:650;font-size:12.5px}
.fev-exp{margin:6px 0 2px;font-size:12px;color:var(--muted)}
pre.code-block{margin:0 0 6px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font:12.5px/1.5 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:normal;overflow-wrap:normal;overflow-x:auto;max-width:100%;user-select:text}
pre.code-block span{white-space:nowrap}
pre.code-block:focus-visible{outline:3px solid var(--accent);outline-offset:1px}
@media (max-width:700px){.kpi .klong,.kpi .pfull{display:none}.kmore{display:block}.kpi .pshort{display:inline}
.kpi .d{font-size:13px}.kpi-h{align-items:flex-start}.kpi h2{font-size:13.5px}
details.fdet[open]{padding:8px 10px}}
`;
