import crypto from "node:crypto";
import fs from "node:fs/promises";
import { finalizePresentation } from "file:///C:/Users/WCL/.codex/plugins/cache/openai-primary-runtime/presentations/26.1024.11018/skills/presentations/container_tools/artifact_tool_utils.mjs";

const workspaceDir = "C:/Users/WCL/Documents/GitHub/homecare";
const skillDir = "C:/Users/WCL/.codex/plugins/cache/openai-primary-runtime/presentations/26.1024.11018/skills/presentations";
const sourcePath = `${workspaceDir}/output/최종 데모용_발표 보강본.pptx`;
const sourceSha256 = crypto.createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");

const result = await finalizePresentation({
  workspaceDir,
  candidatePath: `${workspaceDir}/.ppt-build/candidate-i2-i3-scenario-revision.pptx`,
  finalPath: `${workspaceDir}/output/최종 데모용_I2-I3 시나리오 수정.pptx`,
  pythonExecutable: "C:/Users/WCL/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
  integrityValidatorPath: `${skillDir}/container_tools/inspect_presentation_package_integrity.py`,
  layoutValidatorPath: `${skillDir}/container_tools/inspect_presentation_layout_geometry.py`,
  layoutArgs: [
    "--expected-slide-size-emu", "20104100,11309350",
    "--validate-heading-fit",
    "--require-native-table-slide", "11",
  ],
  explicitTotalSlideCount: 20,
  requiredNativeTableOwnerSlides: [11],
  fontPolicy: {
    basis: "reference",
    families: [
      "Arial",
      "Calibri",
      "Consolas",
      "Courier New",
      "HY견고딕",
      "KoPubWorld바탕체 Bold",
      "KoPubWorld바탕체 Medium",
      "Noto Sans KR",
      "맑은 고딕",
    ],
    referencePath: sourcePath,
    referenceSha256: sourceSha256,
  },
  verifyArtifactToolImport: true,
  receiptPath: `${workspaceDir}/.ppt-build/최종 데모용_I2-I3 시나리오 수정.validation.json`,
});

console.log(JSON.stringify({
  finalPath: result.finalPath,
  slideCount: result.packageIntegrity.slide_count,
  integrity: result.packageIntegrity.status,
  layoutFindings: result.presentationLayout.finding_count,
  importPassed: result.firstPartyImport.passed,
}, null, 2));

