import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertScheduleItem, InsertUser, ScheduleItem, scheduleItems, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function listScheduleItems(userId: number): Promise<ScheduleItem[]> {
  const db = await requireDb();
  return db.select().from(scheduleItems)
    .where(eq(scheduleItems.userId, userId))
    .orderBy(asc(scheduleItems.startAt))
    .limit(200);
}

export async function getScheduleItem(userId: number, id: number): Promise<ScheduleItem | undefined> {
  const db = await requireDb();
  const [item] = await db.select().from(scheduleItems)
    .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id)))
    .limit(1);
  return item;
}

export type NewScheduleItem = Pick<InsertScheduleItem, "title" | "description" | "category" | "startAt" | "endAt" | "status">;

export async function createScheduleItem(userId: number, item: NewScheduleItem): Promise<ScheduleItem> {
  const db = await requireDb();
  const [created] = await db.insert(scheduleItems).values({ ...item, userId }).$returningId();
  if (!created) throw new Error("Could not create schedule item");
  const result = await getScheduleItem(userId, created.id);
  if (!result) throw new Error("Created schedule item could not be loaded");
  return result;
}

export type ScheduleItemPatch = Partial<Pick<InsertScheduleItem, "title" | "description" | "category" | "startAt" | "endAt" | "status">>;

export async function updateScheduleItem(userId: number, id: number, patch: ScheduleItemPatch): Promise<ScheduleItem | undefined> {
  const db = await requireDb();
  const existing = await getScheduleItem(userId, id);
  if (!existing) return undefined;
  await db.update(scheduleItems).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id)));
  return getScheduleItem(userId, id);
}

export async function removeScheduleItem(userId: number, id: number): Promise<boolean> {
  const db = await requireDb();
  const existing = await getScheduleItem(userId, id);
  if (!existing) return false;
  await db.delete(scheduleItems)
    .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id)));
  return true;
}
