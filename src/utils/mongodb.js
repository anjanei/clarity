import { MongoClient } from 'mongodb';
import { config } from '../config.js';

let clientPromise = null;
let indexesPromise = null;

export function mongoAuditConfigured() {
  return config.auditMemory.store === 'mongodb' && Boolean(config.auditMemory.mongodbUri);
}

export async function auditCollection() {
  if (!mongoAuditConfigured()) return null;
  clientPromise ??= MongoClient.connect(config.auditMemory.mongodbUri, {
    appName: 'fdaapproval',
    serverSelectionTimeoutMS: 5000,
  });
  const client = await clientPromise;
  const collection = client
    .db(config.auditMemory.mongodbDb)
    .collection(config.auditMemory.mongodbCollection);
  indexesPromise ??= Promise.all([
    collection.createIndex({ auditId: 1 }, { unique: true }),
    collection.createIndex({ 'trial.trialId': 1, startedAt: -1 }),
  ]);
  await indexesPromise;
  return collection;
}

export async function closeMongoForTests() {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  indexesPromise = null;
  await client.close();
}
