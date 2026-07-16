import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';

let SQL: SqlJsStatic | null = null;
const databases: Map<string, Database> = new Map();

async function initSQL(): Promise<SqlJsStatic> {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}

export async function openDatabase(dataDir: string, dbName: string): Promise<Database> {
    const key = dbName;
    if (databases.has(key)) {
        return databases.get(key)!;
    }

    const SQL = await initSQL();
    const dbPath = path.join(dataDir, `${dbName}.sqlite`);

    let db: Database;
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    databases.set(key, db);
    return db;
}

export async function saveDatabase(dataDir: string, dbName: string): Promise<void> {
    const db = databases.get(dbName);
    if (!db) return;

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, `${dbName}.sqlite`);
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

export function getDatabase(dbName: string): Database | undefined {
    return databases.get(dbName);
}

export async function dropDatabase(dbName: string): Promise<void> {
    const db = databases.get(dbName);
    if (db) {
        db.close();
        databases.delete(dbName);
    }
}

export async function closeAllDatabases(): Promise<void> {
    for (const [, db] of databases) {
        db.close();
    }
    databases.clear();
}
