/** CSS i dashboard-it (shërbehet si /style.css; CSP lejon vetëm stile nga 'self'). */
export const STYLE = `
:root{--bg:#f6f7f9;--panel:#fff;--text:#1d2330;--muted:#5d6678;--line:#e3e6ec;--accent:#2f5bd3;
--crit:#b3261e;--high:#c2410c;--med:#a16207;--low:#4b6b8a;--ok:#1f7a4d;--warn:#a16207;--info:#4b6b8a;
--chip:#eef1f6;--code:#f1f3f7;--shadow:0 1px 2px rgba(20,30,50,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--panel:#1a1e26;--text:#e4e7ee;--muted:#9aa3b5;--line:#2b313d;
--accent:#7ea2ff;--crit:#ff8a80;--high:#ffab70;--med:#e5c07b;--low:#9cb4cc;--ok:#6fcf97;--warn:#e5c07b;--info:#9cb4cc;
--chip:#232935;--code:#20252f;--shadow:none}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.top{background:var(--panel);border-bottom:1px solid var(--line);padding:12px 24px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}
header.top .brand{font-weight:650}
header.top nav a{color:var(--muted);text-decoration:none;margin-right:14px}
header.top nav a:hover{color:var(--accent)}
.local{margin-left:auto;font-size:12px;color:var(--muted)}
main{max-width:1180px;margin:0 auto;padding:20px 24px 60px}
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
select,button{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);max-width:420px}
button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}
label.field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);margin:8px 0}
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
@media (max-width:700px){main{padding:12px}.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}.ev,pre{max-width:calc(100vw - 60px)}header.top{padding:10px 12px}th:nth-child(n+6),td:nth-child(n+6){display:none}}
`;
