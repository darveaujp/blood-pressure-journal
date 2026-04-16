import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<any> | null = null;

export async function getDb() {
  if (!dbPromise) {
    const anySqlite: any = SQLite;
    if (typeof anySqlite.openDatabaseAsync === 'function') {
      dbPromise = anySqlite.openDatabaseAsync('bpjournal.db');
    } else {
      dbPromise = Promise.resolve((SQLite as any).openDatabase('bpjournal.db'));
    }
  }
  return dbPromise;
}

export async function execAsync(sql: string, params: unknown[] = []) {
  const db: any = await getDb();

  if (params.length && typeof db.runAsync === 'function') {
    return db.runAsync(sql, params);
  }

  if (!params.length && typeof db.execAsync === 'function') {
    return db.execAsync(sql);
  }

  return new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx: any) => {
        tx.executeSql(sql, params, () => resolve(), (_: any, err: any) => {
          reject(err);
          return false;
        });
      },
      (err: any) => reject(err)
    );
  });
}

export async function queryAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db: any = await getDb();

  if (typeof db.getAllAsync === 'function') {
    return db.getAllAsync(sql, params);
  }

  if (typeof db.getEachAsync === 'function') {
    const rows: T[] = [];
    for await (const row of db.getEachAsync(sql, params)) {
      rows.push(row as T);
    }
    return rows;
  }

  return new Promise<T[]>((resolve, reject) => {
    db.transaction(
      (tx: any) => {
        tx.executeSql(
          sql,
          params,
          (_: any, result: any) => resolve(result.rows?._array ?? []),
          (_: any, err: any) => {
            reject(err);
            return false;
          }
        );
      },
      (err: any) => reject(err)
    );
  });
}
