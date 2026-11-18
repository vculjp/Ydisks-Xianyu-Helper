import{d as a}from"./download-BaMdvJtq.js";const s=o=>o.map(t=>t.map(n=>`"${String(n).replace(/"/g,'""')}"`).join(",")).join(`
`),e=(o,t)=>{a(new Blob(["\uFEFF"+s(t)],{type:"text/csv;charset=utf-8"}),o)};export{e as d};
