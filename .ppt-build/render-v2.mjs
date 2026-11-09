import fs from 'node:fs/promises';
import {PresentationFile,FileBlob} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=await PresentationFile.importPptx(await FileBlob.load('.ppt-build/candidate-v2.pptx'));
for(const index of [3,4,10]){await fs.writeFile(`.ppt-build/v2-slide${index+1}.png`,new Uint8Array(await (await p.export({slide:p.slides.items[index],format:'png',scale:0.8})).arrayBuffer()));}
console.log('Rendered slides 4, 5, 11');
