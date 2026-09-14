import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const expected = new Map([
  ["en", "Medication"],
  ["pt", "Medicação"],
  ["es", "Medicación"],
]);

const targetRoots = [
  "ios/App/App",
  "ios/App/Assistente Watch Watch App",
];

test("nome nativo localizado existe para iPhone e Watch", () => {
  for (const targetRoot of targetRoots) {
    for (const [language, name] of expected) {
      const path = `${targetRoot}/${language}.lproj/InfoPlist.strings`;
      assert.equal(fs.existsSync(path), true, `arquivo ausente: ${path}`);

      const contents = fs.readFileSync(path, "utf8");
      assert.match(
        contents,
        new RegExp(`"CFBundleDisplayName"\\s*=\\s*"${name}"\\s*;`),
        `nome incorreto em ${path}`,
      );
    }
  }
});

test("Xcode empacota a localização do iPhone e mantém inglês como fallback", () => {
  const pbx = fs.readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

  assert.match(pbx, /PBXVariantGroup[\s\S]*?InfoPlist\.strings/);
  assert.match(pbx, /InfoPlist\.strings in Resources/);

  assert.match(
    pbx,
    /knownRegions = \([\s\S]*?\ben,[\s\S]*?\bpt,[\s\S]*?\bes,[\s\S]*?\);/,
  );

  assert.match(pbx, /developmentRegion = en;/);
});

test("Watch mantém a pasta sincronizada que inclui os InfoPlist.strings localizados", () => {
  const pbx = fs.readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

  assert.match(
    pbx,
    /PBXFileSystemSynchronizedRootGroup[\s\S]*?path = "Assistente Watch Watch App"/,
  );

  assert.match(
    pbx,
    /fileSystemSynchronizedGroups = \([\s\S]*?Assistente Watch Watch App[\s\S]*?\);/,
  );
});
