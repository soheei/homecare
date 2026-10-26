import { FileBlob, PresentationFile } from "file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const p = await PresentationFile.importPptx(await FileBlob.load("output/최종 데모용_I2-I3 시나리오 수정.pptx"));
const result = await p.inspect({ kind: "slide,textbox,table,notes", maxChars: 200000 });
console.log(result.ndjson);
