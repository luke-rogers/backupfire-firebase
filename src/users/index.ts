import * as tools from 'firebase-tools'
import * as admin from 'firebase-admin'
import { tmpdir } from 'os'
import { resolve, parse } from 'path'
import operationResponse, { UsersStatusResponse } from '../_lib/operation'
import asyncMiddleware from '../_lib/asyncMiddleware'
import { promisify } from 'util'
import fs from 'fs'

const unlink = promisify(fs.unlink)
const readFile = promisify(fs.readFile)

export type UsersBackupOptions = {
  bucketsAllowlist?: string[]
  projectId: string
}

export type UsersBackupRequestOptions = {
  storageId: string
  path: string
}

export function backupUsersMiddleware({
  bucketsAllowlist,
  projectId,
}: UsersBackupOptions) {
  return asyncMiddleware(async (request, response) => {
    // TODO: Validate options
    const options = request.body as UsersBackupRequestOptions
    const state = await backupUsers(projectId, options)
    operationResponse(response, state)
  })
}

async function backupUsers(
  projectId: string,
  options: UsersBackupRequestOptions
): Promise<UsersStatusResponse> {
  // Create bucket
  const bucket = admin.storage().bucket(options.storageId)

  // Create temporary file path
  const path = tmpPath(options.path)

  // Export users to a temporary file
  await tools.auth.export(path, { project: projectId })

  // Calculate the number of users
  const usersCount = await readFile(path, 'utf8')
    .then(JSON.parse)
    .then(({ users }: { users: any[] }) => users.length)
    // TODO: Add to log
    .catch((_err) => undefined)

  // Parsing has failed, the exported file is unreadable
  if (usersCount === undefined) {
    // Remove the temporary file
    await unlink(path)

    return {
      state: 'failed',
      data: { reason: 'Failed to parse the backup file' },
    }
  }

  // Upload the users backup to the storage
  const size = await bucket
    .upload(path, { destination: options.path })
    .then(([file]) => file.metadata.size as string)

  // Remove the temporary file
  await unlink(path)

  return { state: 'completed', data: { usersCount, size } }
}

/**
 * Generates temporary path on the FS from passed path in a bucket
 * @param path - The path to backup in a bucket
 */
function tmpPath(path: string) {
  const { base: fileName } = parse(path)
  return resolve(tmpdir(), fileName)
}
