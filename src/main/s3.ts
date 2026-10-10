import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListBucketsCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
import { S3Connection } from '../shared/types'
import * as fs from 'fs/promises'
import { createReadStream, createWriteStream, ReadStream } from 'fs'
import { dirname } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export type ProgressCallback = (loaded: number, total: number) => void

function createProgressStream(totalBytes: number, onProgress: ProgressCallback): Transform {
  let loaded = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length
      onProgress(loaded, totalBytes)
      this.push(chunk)
      callback()
    }
  })
}

const CONTENT_TYPE = 'application/octet-stream'
const MAX_S3_OBJECT_SIZE = 5 * 1024 * 1024 * 1024 * 1024
const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024
const DEFAULT_MULTIPART_PART_SIZE = 16 * 1024 * 1024
const MAX_MULTIPART_PARTS = 10000
const MULTIPART_THRESHOLD = 64 * 1024 * 1024

function getClient(connection: S3Connection): S3Client {
  return new S3Client({
    region: connection.region || 'us-east-1',
    endpoint: connection.endpoint,
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey,
    },
    // Force path style for minio/custom s3 compatibility
    forcePathStyle: true,
  })
}

function roundUpToMiB(size: number): number {
  const oneMiB = 1024 * 1024
  return Math.ceil(size / oneMiB) * oneMiB
}

function getMultipartPartSize(fileSize: number): number {
  const requiredPartSize = Math.ceil(fileSize / MAX_MULTIPART_PARTS)
  return Math.max(MIN_MULTIPART_PART_SIZE, DEFAULT_MULTIPART_PART_SIZE, roundUpToMiB(requiredPartSize))
}

function createFilePartStream(localPath: string, start: number, end: number): ReadStream {
  return createReadStream(localPath, { start, end })
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body
  }

  if (body && typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as Readable
  }

  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
    return Readable.fromWeb((body as { transformToWebStream: () => any }).transformToWebStream())
  }

  throw new Error('Unsupported response body stream')
}

export async function moveTempFile(partialDestPath: string, localDestPath: string) {
  try {
    await fs.rename(partialDestPath, localDestPath)
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }

    await fs.rm(localDestPath, { force: true })
    await fs.rename(partialDestPath, localDestPath)
  }
}

async function uploadWithSinglePut(client: S3Client, bucket: string, key: string, localPath: string, fileSize: number, onProgress?: ProgressCallback) {
  let body: string | Readable = ''
  if (fileSize > 0) {
    const fileStream = createReadStream(localPath)
    if (onProgress) {
      const progressStream = createProgressStream(fileSize, onProgress)
      fileStream.pipe(progressStream)
      body = progressStream
    } else {
      body = fileStream
    }
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentLength: fileSize,
    ContentType: CONTENT_TYPE
  }))
}

async function uploadWithMultipart(client: S3Client, bucket: string, key: string, localPath: string, fileSize: number, onProgress?: ProgressCallback) {
  const createResponse = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: CONTENT_TYPE
  }))

  const uploadId = createResponse.UploadId
  if (!uploadId) {
    throw new Error('Multipart upload did not return an upload id')
  }

  const partSize = getMultipartPartSize(fileSize)
  const parts: Array<{ ETag: string; PartNumber: number }> = []

  try {
    let offset = 0
    let partNumber = 1

    while (offset < fileSize) {
      const nextOffset = Math.min(offset + partSize, fileSize)
      const contentLength = nextOffset - offset
      const body = createFilePartStream(localPath, offset, nextOffset - 1)

      const uploadPartResponse = await client.send(new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: contentLength
      }))

      if (!uploadPartResponse.ETag) {
        throw new Error(`Missing ETag for part ${partNumber}`)
      }

      parts.push({ ETag: uploadPartResponse.ETag, PartNumber: partNumber })
      offset = nextOffset
      if (onProgress) onProgress(offset, fileSize)
      partNumber += 1
    }

    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
      }
    }))
  } catch (error) {
    try {
      await client.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId
      }))
    } catch {
      // Ignore abort failures so the original transfer error surfaces.
    }

    throw error
  }
}

export async function listBuckets(connection: S3Connection) {
  const client = getClient(connection)
  const command = new ListBucketsCommand({})
  const response = await client.send(command)
  return response.Buckets?.map(b => b.Name).filter(Boolean) as string[] || []
}

export async function listObjects(connection: S3Connection, bucket: string, prefix: string = '') {
  if (!bucket) throw new Error('No bucket specified')
  const client = getClient(connection)
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/'
  })
  
  const response = await client.send(command)
  return {
    folders: response.CommonPrefixes?.map(p => p.Prefix) || [],
    files: response.Contents?.map(c => ({
      key: c.Key,
      size: c.Size,
      lastModified: c.LastModified
    })).filter(c => c.key !== prefix) || []
  }
}

export async function uploadFile(connection: S3Connection, bucket: string, localPath: string, key: string, onProgress?: ProgressCallback) {
  if (!bucket) throw new Error('No bucket specified')
  const client = getClient(connection)

  try {
    const fileStat = await fs.stat(localPath)

    if (!fileStat.isFile()) {
      throw new Error('Source path is not a file')
    }

    if (fileStat.size > MAX_S3_OBJECT_SIZE) {
      throw new Error('File exceeds the maximum S3 object size of 5 TB')
    }

    if (fileStat.size >= MULTIPART_THRESHOLD) {
      await uploadWithMultipart(client, bucket, key, localPath, fileStat.size, onProgress)
      return
    }

    await uploadWithSinglePut(client, bucket, key, localPath, fileStat.size, onProgress)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upload error'
    throw new Error(`Failed to upload "${localPath}" to "${bucket}/${key}": ${message}`)
  }
}

export async function createFolder(connection: S3Connection, bucket: string, key: string) {
  if (!bucket) throw new Error('No bucket specified')
  const client = getClient(connection)
  
  const folderKey = key.endsWith('/') ? key : `${key}/`
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: folderKey,
    Body: ''
  })
  
  await client.send(command)
}

export async function deleteObject(connection: S3Connection, bucket: string, key: string) {
  if (!bucket) throw new Error('No bucket specified')
  const client = getClient(connection)
  
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  })
  
  await client.send(command)
}

export async function downloadFile(connection: S3Connection, bucket: string, key: string, localDestPath: string, onProgress?: ProgressCallback) {
  if (!bucket) throw new Error('No bucket specified')
  const client = getClient(connection)

  const partialDestPath = `${localDestPath}.part`

  try {
    await fs.mkdir(dirname(localDestPath), { recursive: true })

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })

    const response = await client.send(command)
    if (!response.Body) throw new Error('Empty response body')

    const sourceStream = toNodeReadable(response.Body)
    const outputStream = createWriteStream(partialDestPath)

    if (onProgress && response.ContentLength && response.ContentLength > 0) {
      const progressStream = createProgressStream(response.ContentLength, onProgress)
      await pipeline(sourceStream, progressStream, outputStream)
    } else {
      await pipeline(sourceStream, outputStream)
    }
    await moveTempFile(partialDestPath, localDestPath)
  } catch (error) {
    await fs.rm(partialDestPath, { force: true }).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'Unknown download error'
    throw new Error(`Failed to download "${bucket}/${key}" to "${localDestPath}": ${message}`)
  }
}

export async function deleteFolder(connection: S3Connection, bucket: string, prefix: string) {
  if (!bucket) throw new Error('No bucket specified')
  if (!prefix.endsWith('/')) prefix += '/'
  const client = getClient(connection)

  // List all objects under this prefix recursively
  let continuationToken: string | undefined
  const allKeys: { Key: string }[] = []

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    })
    const response = await client.send(listCommand)
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) allKeys.push({ Key: obj.Key })
      }
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  if (allKeys.length === 0) {
    // Empty folder marker
    await deleteObject(connection, bucket, prefix)
    return
  }

  // Delete in batches of 1000 (S3 limit)
  for (let i = 0; i < allKeys.length; i += 1000) {
    const batch = allKeys.slice(i, i + 1000)
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch }
    })
    await client.send(deleteCommand)
  }
}
