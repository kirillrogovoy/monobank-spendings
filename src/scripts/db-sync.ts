/* eslint "@typescript-eslint/no-non-null-assertion": "off" */
// because we don't care that much in a script
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import env from 'dotenv'
import aws from 'aws-sdk'
import toml from 'toml'

env.config()

main().catch(e => {
  console.error(e.stack)
  process.exit(1)
})
async function main() {
  const tmpDumpFilePath = '/tmp/dump.prod.sql'
  const dumpCommand = await makeDumpCommand(tmpDumpFilePath)
  const restoreCommand = makeRestoreCommand(tmpDumpFilePath)

  console.log('Dumping the production DB...')
  execSync(dumpCommand, {
    stdio: 'inherit',
  })

  console.log('Filling up the local DB...')
  execSync(restoreCommand, {
    stdio: 'inherit',
  })

  console.log('Success.')
}

async function makeDumpCommand(dumpFilePath: string) {
  const rootDir = path.join(__dirname, '../..')
  const samConfigFilepath = path.join(rootDir, 'samconfig.toml')
  const samConfig = toml.parse(fs.readFileSync(samConfigFilepath).toString())
  const region = samConfig.default.deploy.parameters.region
  // eslint-disable-next-line immutable/no-mutation
  aws.config.region = region
  // eslint-disable-next-line immutable/no-mutation
  aws.config.credentials = new aws.SharedIniFileCredentials({
    profile: 'italy',
  })

  const cfn = new aws.CloudFormation()
  const secrets = new aws.SecretsManager()

  const stackName = samConfig.default.deploy.parameters.stack_name
  const stacks = await cfn
    .describeStacks({
      StackName: stackName,
    })
    .promise()
  const outputs = stacks.Stacks![0].Outputs!

  const [host, port, db] = [
    outputs.find(o => o.OutputKey === 'PostgresDBAddress')!.OutputValue!,
    outputs.find(o => o.OutputKey === 'PostgresDBPort')!.OutputValue!,
    process.env.DB_NAME!,
  ]

  const userSecretString = JSON.parse(
    (
      await secrets
        .getSecretValue({
          SecretId: outputs.find(o => o.OutputKey === 'PostgresDBPasswordSecretKey')!.OutputValue!,
        })
        .promise()
    ).SecretString!,
  )

  return `PGPASSWORD=${userSecretString.password} pg_dump -c -U ${userSecretString.username} --host ${host} --port ${port} ${db} > ${dumpFilePath}`
}

function makeRestoreCommand(dumpFilePath: string) {
  const [user, password, host, port, db] = [
    process.env.DB_USER!,
    process.env.DB_PASSWORD!,
    process.env.DB_HOST!,
    process.env.DB_PORT!,
    process.env.DB_NAME!,
  ]
  return `cat ${dumpFilePath} | PGPASSWORD=${password} psql -U ${user} --host ${host} --port ${port} ${db} > /dev/null`
}
