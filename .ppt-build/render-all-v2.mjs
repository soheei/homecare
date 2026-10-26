import fs from 'node:fs/promises';
import {PresentationFile,FileBlob} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=await PresentationFile.importPptx(await FileBlob.load('output/최종 데모용_발표 보강본.pptx'));
await fs.mkdir('.ppt-build/all-v2',{recursive:true});
for(let i=0;i<p.slides.items.length;i++){await fs.writeFile(`.ppt-build/all-v2/slide-${String(i+1).padStart(2,'0')}.png`,new Uint8Array(await (await p.export({slide:p.slides.items[i],format:'png',scale:0.34})).arrayBuffer()));}
console.log('Rendered all 20 final slides');
