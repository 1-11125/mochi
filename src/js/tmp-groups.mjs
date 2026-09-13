import fs from 'fs';
const s=fs.readFileSync('default-cards-data.js','utf8');
const j=JSON.parse(s.slice(s.indexOf('{')));
const out={};
for(const k in j){out[k]=j[k].map(g=>g[0]+' ('+g[1].length+')');}
fs.writeFileSync('tmp-groups.json',JSON.stringify(out,null,1));
console.log('keys:',Object.keys(j).join(','),'groups:',Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v.length])));
