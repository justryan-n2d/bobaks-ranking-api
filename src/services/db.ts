import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/database";

const databaseUrl = process.env.DATABASE_URL?.trim();

export const prisma = databaseUrl
  ? new PrismaClient({
      datasources: {
        db: {
          url: getDatabaseUrl()
        }
      }
    })
  : new PrismaClient();
