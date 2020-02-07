/* eslint "@typescript-eslint/no-non-null-assertion": "off" */
// because we don't care that much in a script
import path, { join } from 'path'
import fs from 'fs'
import env from 'dotenv'
import aws from 'aws-sdk'
import toml from 'toml'
import { Client } from 'pg'
import Jimp from 'jimp'

env.config()

main().catch(e => {
  console.error(e.stack)
  process.exit(1)
})
async function main() {
  const rootDir = path.join(__dirname, '../..')

  const environment = !!process.env.DB_PROD ? 'prod' : 'dev'

  console.log(`Environment: ${environment}`)

  const dbParams = environment === 'prod' ? await makeDbParamsProd(rootDir) : makeDbParamsDev()

  const dbClient = new Client(dbParams)
  dbClient.connect()

  const mediaResult = await dbClient.query('SELECT id, url FROM product_media WHERE width IS NULL')
  console.log('Unprocessed images:', mediaResult.rowCount)

  const getImagePath = (relativePath: string) =>
    join(__dirname, '../../../web/public', relativePath)

  const mediaWithImageDescription = await Promise.all(
    mediaResult.rows.map(async row => ({
      id: row.id,
      url: row.url,
      imageDescription: await Jimp.read(getImagePath(row.url)).then(x => x.bitmap),
    })),
  )

  await Promise.all(
    mediaWithImageDescription.map(media => {
      return dbClient.query('UPDATE product_media SET width = $1, height = $2 WHERE id = $3', [
        media.imageDescription.width,
        media.imageDescription.height,
        media.id,
      ])
    }),
  )

  process.exit(0)
}

async function makeDbParamsProd(rootDir: string) {
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

  const [host, port, database] = [
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

  return {
    host,
    port: Number(port),
    database,
    user: userSecretString.username,
    password: userSecretString.password,
  }
}

function makeDbParamsDev() {
  const [user, password, host, port, database] = [
    process.env.DB_USER!,
    process.env.DB_PASSWORD!,
    process.env.DB_HOST!,
    process.env.DB_PORT!,
    process.env.DB_NAME!,
  ]
  return { user, password, host, port: Number(port), database }
}
