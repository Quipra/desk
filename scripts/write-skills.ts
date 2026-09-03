// Writes skills/<name>/SKILL.md from src/skills.ts so the repo copy never drifts.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { SKILLS, skillIndex } from "../src/skills.ts";

rmSync("skills", { recursive: true, force: true });
for (const [name, skill] of Object.entries(SKILLS)) {
  mkdirSync(`skills/${name}`, { recursive: true });
  writeFileSync(
    `skills/${name}/SKILL.md`,
    `---\nname: desk-${name}\ndescription: ${skill.when[0].toUpperCase()}${skill.when.slice(1)}. Drawing at the Desk through WebMCP.\n---\n\n${skill.body}\n`,
  );
}
writeFileSync(
  "skills/README.md",
  `# Desk skills\n\nWhat an agent needs at the desk, one file per task. In the app the same text is served by the \`guide\` tool (\`guide { topic }\`), and \`core\` rides on the first \`look\`. Generated from \`src/skills.ts\` by \`npm run skills\`; edit there.\n\n${skillIndex().replace("SKILLS (read one with guide { topic }):", "").trim()}\n`,
);
console.log(`wrote ${Object.keys(SKILLS).length} skills`);
