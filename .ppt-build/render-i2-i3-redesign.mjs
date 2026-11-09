import fs from 'node:fs/promises';
import {PresentationFile,FileBlob} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=await PresentationFile.importPptx(await FileBlob.load('.ppt-build/candidate-i2-i3-redesign.pptx'));
for(const index of [3,4]){
  await fs.writeFile(`.ppt-build/redesign-slide-${index+1}.png`,new Uint8Array(await (await p.export({slide:p.slides.items[index],format:'png',scale:0.9})).arrayBuffer()));
  await fs.writeFile(`.ppt-build/redesign-slide-${index+1}.layout.json`,await (await p.slides.items[index].export({format:'layout',detail:'full'})).text());
}
console.log('Rendered redesigned slides 4 and 5');
