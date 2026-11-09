import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "file:///C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const p = await PresentationFile.importPptx(
  await FileBlob.load("output/최종 데모용_I2-I3 시나리오 수정.pptx"),
);
await fs.mkdir(".ppt-build/final-i2-i3-scenario", { recursive: true });
for (let i = 0; i < p.slides.items.length; i++) {
  const png = await p.export({ slide: p.slides.items[i], format: "png", scale: i === 3 || i === 4 ? 0.9 : 0.28 });
  await fs.writeFile(
    `.ppt-build/final-i2-i3-scenario/slide-${String(i + 1).padStart(2, "0")}.png`,
    new Uint8Array(await png.arrayBuffer()),
  );
}
console.log(`Rendered ${p.slides.items.length} final slides`);

