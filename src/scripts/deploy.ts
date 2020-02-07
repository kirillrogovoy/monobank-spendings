import path from 'path'
import { execSync } from 'child_process'

main()
async function main() {
  const rootDir = path.join(__dirname, '../..')

  const outDir = path.join(rootDir, 'out')

  const depsDir = path.join(rootDir, 'dependencies/nodejs')
  const depsNodeModulesDir = path.join(depsDir, 'node_modules')

  console.log('Building code...')
  execSync(`rm -rf ${outDir} && tsc -p ${path.join(rootDir, 'tsconfig.json')} --outDir ${outDir}`, {
    stdio: 'inherit',
  })

  console.log('Packing dependencies...')
  execSync(
    `rm -rf ${depsDir} && mkdir -p ${depsNodeModulesDir} && npm ls --prefix=${rootDir} --only=prod --parseable | grep node_modules/ | xargs -I '{}' cp -ap '{}' ${depsNodeModulesDir}`,
    {
      stdio: 'inherit',
    },
  )

  execSync(`mv dist _dist && mv out dist`)

  execSync(`sam deploy -t ${path.join(rootDir, 'template.yaml')}`, {
    stdio: 'inherit',
  })

  execSync(`rm -rf dist && mv _dist dist`)
}
