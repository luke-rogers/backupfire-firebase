import bodyParser from 'body-parser'
import express from 'express'
import jwt from 'express-jwt'
import cors from 'cors'
import * as functions from 'firebase-functions'
import {
  backupFirestoreMiddleware,
  checkFirestoreBackupStatusMiddleware
} from './firestore'
import { backupUsersMiddleware } from './users'
import fetch from 'node-fetch'
import { format } from 'url'
import {
  storageListMiddleware,
  createStorageMiddleware,
  updateStorageMiddleware
} from './storage'

export const defaultControllerDomain = 'backupfire.dev'

export const defaultRegion = 'us-central1'

/**
 * Backup Fire agent options.
 */
export type BackupFireOptions = {
  /**
   * The controller app domain, defaults to backupfire.dev.
   */
  controllerDomain?: string

  /**
   * The controller access token that allows to securely communicate with
   * the controller.
   */
  controllerToken: string

  /**
   * The admin password which protects the agent from unauthorized commands
   * from the controller.
   */
  adminPassword: string

  /**
   * The list of buckets where the data can be backed up. It protects the agent
   * from malformed backup commands from the controller.
   */
  bucketsAllowlist?: string[]

  /**
   * Make the agent print debug messages to the log.
   */
  debug?: boolean
}

type BackupFireEnvConfig = {
  domain?: string
  token: string
  password: string
  allowlist?: string
  debug?: string
}

type IncompleteRuntimeEnvironment = {
  region: string | undefined
  projectId: string | undefined
  functionName: string | undefined
}

type RuntimeEnvironment = {
  region: string
  projectId: string
  functionName: string
}

/**
 * Creates Backup Fire Firebase Functions HTTPS handler.
 *
 * @param options - The Backup Fire agent options
 */
export default function backupFire() {
  // Derive Backup Fire options from environment configuration

  const envConfig = functions.config().backupfire as
    | BackupFireEnvConfig
    | undefined

  // If options aren't set, use  dummy handler instead
  if (!envConfig) {
    console.warn(
      `Warning: "backupfire" key isn't found in the Functions environment configuration. Running a dummy HTTP handler instead of the Backup Fire agent...`
    )
    return dummyHandler()
  }

  const options = {
    controllerDomain: envConfig.domain,
    controllerToken: envConfig.token,
    adminPassword: envConfig.password,
    bucketsAllowlist:
      (envConfig.allowlist && envConfig.allowlist.split(',')) || undefined,
    debug: envConfig.debug === 'true'
  }

  // Get runtime environment (Firebase project ID, region, etc)

  const runtimeEnv = getRuntimeEnv()

  // If the function name isn't backupfire, use dummy handler
  if (runtimeEnv.functionName !== 'backupfire') {
    if (options.debug)
      console.log(
        `The function name isn't "backupfire" (${runtimeEnv.functionName}). Running a dummy HTTP handler instead of the Backup Fire agent...`
      )
    return dummyHandler()
  }

  // If some of the variables are missing, use dummy handler
  if (!isCompleteRuntimeEnv(runtimeEnv)) {
    console.warn(
      'Warning: runtime environment is incomplete:',
      prettyJSON(runtimeEnv)
    )
    console.warn(
      'Running a dummy HTTP handler instead of the Backup Fire agent...'
    )
    return dummyHandler()
  }

  if (options.debug) {
    console.log(
      'Initializing Backup Fire agent with options:',
      prettyJSON(options)
    )
    console.log('Runtime environment:', prettyJSON(runtimeEnv))
  }

  // Send the initialization ping to the controller
  sendInitializationPing(options, runtimeEnv)

  return functions
    .region(defaultRegion)
    .https.onRequest(createApp(runtimeEnv, options))
}

/**
 * Creates [Express] app that serves as an agent that provide API to
 * the Backup Fire controller.
 *
 * @param runtimeEnv - The runtime environment variables
 * @param options - The Backup Fire agent options
 *
 * [Express]: https://expressjs.com/
 */
export function createApp(
  runtimeEnv: RuntimeEnvironment,
  options: BackupFireOptions
) {
  // Create Express app that would be mounted as a function
  const app = express()

  // Protect Backup Fire API with token authorization
  app.use(jwt({ secret: options.controllerToken }))

  // Parse JSON body
  app.use(bodyParser.json())

  // Allow requests from web
  app.use(cors({ origin: true }))

  const globalOptions = { bucketsAllowlist: options.bucketsAllowlist }

  // Backup Firestore
  app.post('/firestore', backupFirestoreMiddleware(globalOptions))
  // Check Firestore backup status
  app.get('/firestore/status', checkFirestoreBackupStatusMiddleware())

  // Backup Firebase users
  app.post(
    '/users',
    backupUsersMiddleware({ projectId: runtimeEnv.projectId, ...globalOptions })
  )

  // List storage
  app.get('/storage', storageListMiddleware(globalOptions))
  // Create storage
  app.post('/storage', createStorageMiddleware(globalOptions))
  // Update storage
  app.put('/storage/:storageId', updateStorageMiddleware(globalOptions))

  return app
}

function sendInitializationPing(
  options: BackupFireOptions,
  runtimeEnv: RuntimeEnvironment
) {
  // TODO: Report failure if the request fails
  const pingURL = format({
    hostname: options.controllerDomain || defaultControllerDomain,
    protocol: 'https',
    pathname: '/ping',
    query: {
      // TODO: Send more data:
      // - Agent version
      // - Node.js version
      // - Function region
      // - Something else?
      token: options.controllerToken,
      projectId: runtimeEnv.projectId,
      agentURL: agentURL(runtimeEnv)
    }
  })
  return fetch(pingURL)
}

function agentURL(runtimeEnv: RuntimeEnvironment) {
  const { region, projectId, functionName } = runtimeEnv
  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`
}

function getRuntimeEnv(): IncompleteRuntimeEnvironment | RuntimeEnvironment {
  return {
    region: defaultRegion,
    // Node.js v8 runtime sets GCP_PROJECT, while v10 uses depricated GCLOUD_PROJECT
    projectId: process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT,
    // Node.js v8 runtime uses FUNCTION_NAME, v10 — FUNCTION_TARGET
    // See: https://cloud.google.com/functions/docs/env-var#environment_variables_set_automatically
    functionName: process.env.FUNCTION_NAME || process.env.FUNCTION_TARGET
  }
}

function isCompleteRuntimeEnv(
  runtimeEnv: IncompleteRuntimeEnvironment | RuntimeEnvironment
): runtimeEnv is RuntimeEnvironment {
  return (
    !!runtimeEnv.functionName && !!runtimeEnv.projectId && !!runtimeEnv.region
  )
}

function dummyHandler() {
  return functions
    .region(defaultRegion)
    .https.onRequest((_req, resp) => resp.end())
}

function prettyJSON(obj: any) {
  return JSON.stringify(obj, null, 2)
}
