import path from 'path'
import fs from 'fs'
import yamlCfn from 'yaml-cfn'
import { execSync } from 'child_process'
import env from 'dotenv'

env.config()

main()
async function main() {
  const rootDir = path.join(__dirname, '../..')
  const samTemplateFilepath = path.join(rootDir, 'template.yaml')
  const localSamTemplateFilepath = path.join(rootDir, 'template.local.yaml')

  const samTemplate = yamlCfn.yamlParse(fs.readFileSync(samTemplateFilepath).toString())
  delete samTemplate.Globals.Function.Layers
  // eslint-disable-next-line immutable/no-mutation
  samTemplate.Globals.Function.Timeout = 20
  const samTemplateLocal = yamlCfn.yamlDump(samTemplate)

  fs.writeFileSync(localSamTemplateFilepath, samTemplateLocal)

  const distNodeModulesDir = path.join(rootDir, 'dist/node_modules')
  execSync(
    `rm -rf ${distNodeModulesDir} && mkdir -p ${distNodeModulesDir} && npm ls --prefix=${rootDir} --only=prod --parseable | grep node_modules/ | xargs -I '{}' cp -ap '{}' ${distNodeModulesDir}`,
    {
      stdio: 'inherit',
    },
  )

  const cleanup = () => execSync(`rm -rf ${distNodeModulesDir}`, { stdio: 'inherit' })

  process.on('SIGINT', cleanup)
  process.on('beforeExit', cleanup)

  execSync(
    `sam local start-api --skip-pull-image -p 4000 -t ${localSamTemplateFilepath} --docker-network dev_foodeon_local`,
    {
      stdio: 'inherit',
    },
  )
}
