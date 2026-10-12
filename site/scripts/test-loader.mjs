// Node 20 cannot run the .ts test files natively. Use the same installed
// TypeScript compiler as the production build, without installing a runtime.
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
    const source = await readFile(new URL(url), 'utf8')
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: new URL(url).pathname,
    })
    return { format: 'module', source: result.outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
