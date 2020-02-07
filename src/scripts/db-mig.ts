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
  const rootDir = path.join(__dirname, '../..')
  const args = process.argv.slice(2)

  const environment = !!process.env.MIG_PROD ? 'prod' : 'dev'

  console.log(`Environment: ${environment}`)

  const dbUri = environment === 'prod' ? await makeDbUriProd(rootDir) : makeDbUriDev()

  console.log(`DB Uri: ${dbUri}`)

  console.log('Running dbmate...')

  // eslint-disable-next-line immutable/no-mutation
  process.env.DATABASE_URL = dbUri

  const dbmateCommand = `docker run --env DATABASE_URL --net host --rm -v "${path.join(
    rootDir,
    'db',
  )}":/db amacneil/dbmate ${args.join(' ')}`
  console.log(`dbmate command: ${dbmateCommand}`)
  execSync(dbmateCommand, {
    stdio: 'inherit',
  })
}

async function makeDbUriProd(rootDir: string) {
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

  return makeDbUri(userSecretString.username, userSecretString.password, host, port, db)
}

function makeDbUriDev() {
  const [user, password, host, port, db] = [
    process.env.DB_USER!,
    process.env.DB_PASSWORD!,
    process.env.DB_HOST!,
    process.env.DB_PORT!,
    process.env.DB_NAME!,
  ]
  return makeDbUri(user, password, host, port, db)
}

function makeDbUri(user: string, password: string, host: string, port: string, db: string) {
  return `postgres://${user}:${password}@${host}:${port}/${db}?sslmode=disable`
}
