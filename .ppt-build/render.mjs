import fs from 'node:fs/promises';
import {PresentationFile,FileBlob} from 'file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=await PresentationFile.importPptx(await FileBlob.load('.ppt-build/candidate.pptx'));
await fs.writeFile('.ppt-build/eval.png',new Uint8Array(await (await p.export({slide:p.slides.items[8],format:'png',scale:0.7})).arrayBuffer()));
