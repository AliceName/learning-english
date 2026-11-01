import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Bundle the actual React components in isolation. No listener, running app, account or database is changed.
// Only Next navigation and CSS loading are adapted; API fixtures are supplied by Playwright routing.
export async function buildListeningHarness() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(path.join(root, "package.json"));
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "englishlearning-listening-ui-"));
  const js = value => JSON.stringify(value.replaceAll("\\", "/"));
  await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = function(source) { return require(${js(path.join(root, "node_modules/typescript"))}).transpileModule(source, {compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText; };`);
  await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
    const prefix = 's_' + require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8) + '_';
    const classes = {}; const css = source.replace(/\\.([A-Za-z_][\\w-]*)/g, (_, name) => {classes[name]=prefix+name;return '.'+prefix+name;});
    return 'const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.appendChild(style);module.exports=' + JSON.stringify(classes) + ';';
  };`);
  await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react'; export default function Link({href,children,prefetch,replace,scroll,...props}) {return <a href={href} {...props}>{children}</a>;}`);
  await fs.writeFile(path.join(temporary, "navigation.ts"), `export function usePathname(){return location.pathname;} export function useRouter(){return {push(href){location.assign(href)},refresh(){location.reload()},replace(href){location.replace(href)}};}`);
  await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client';
    import MemberShell from ${js(path.join(root, "src/components/navigation/member-shell.tsx"))};
    import ListeningPractice from ${js(path.join(root, "src/components/listening/listening-practice.tsx"))};
    createRoot(document.getElementById('app')).render(<MemberShell user={{userId:42,email:'listening-test@example.com',fullName:'Học viên kiểm thử',role:'user',targetLevel:'B1',currentStreak:2}}><ListeningPractice lesson={window.__LISTENING_FIXTURE__}/></MemberShell>);`);
  const compiler = webpack({
    mode: "development", devtool: false, context: root, entry: path.join(temporary, "entry.tsx"),
    output: { path: temporary, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: {
      "@": path.join(root, "src"), "next/link$": path.join(temporary, "link.tsx"), "next/navigation$": path.join(temporary, "navigation.ts"),
    } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(temporary, "typescript.cjs") }, { test: /\.css$/, use: path.join(temporary, "css.cjs") }] },
  });
  try {
    await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  } finally { await new Promise(resolve => compiler.close(resolve)); }
  return { bundle: await fs.readFile(path.join(temporary, "app.js"), "utf8"), cleanup: async () => {
    const resolved = path.resolve(temporary), allowed = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith("englishlearning-listening-ui-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}
