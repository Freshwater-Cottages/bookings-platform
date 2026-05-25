import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.BOOKING_GUEST_RANGE_TRIGGER_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

describeWithDatabase("BookingGuest stay range database triggers", () => {
  it("rejects guest rows and booking date updates outside the booking envelope", async () => {
    const schemaName = `booking_guest_range_${randomUUID().replaceAll("-", "")}`;
    const schema = quoteIdentifier(schemaName);
    const client = new Client({ connectionString: databaseUrl });
    const migration = await readFile(
      path.join(
        process.cwd(),
        "prisma/migrations/20260525030000_enforce_booking_guest_stay_range_envelope/migration.sql",
      ),
      "utf8",
    );

    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`
        CREATE TABLE "Booking" (
          "id" TEXT PRIMARY KEY,
          "checkIn" DATE NOT NULL,
          "checkOut" DATE NOT NULL
        );

        CREATE TABLE "BookingGuest" (
          "id" TEXT PRIMARY KEY,
          "bookingId" TEXT NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
          "stayStart" DATE NOT NULL,
          "stayEnd" DATE NOT NULL
        );
      `);
      await client.query(migration);

      await client.query(`
        INSERT INTO "Booking" ("id", "checkIn", "checkOut")
        VALUES ('booking-1', DATE '2026-06-10', DATE '2026-06-15')
      `);
      await client.query(`
        INSERT INTO "BookingGuest" ("id", "bookingId", "stayStart", "stayEnd")
        VALUES ('guest-valid', 'booking-1', DATE '2026-06-10', DATE '2026-06-12')
      `);

      await expect(
        client.query(`
          INSERT INTO "BookingGuest" ("id", "bookingId", "stayStart", "stayEnd")
          VALUES ('guest-outside', 'booking-1', DATE '2026-06-09', DATE '2026-06-12')
        `),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "BookingGuest_stay_range_within_booking",
      });

      await expect(
        client.query(`
          UPDATE "Booking"
          SET "checkIn" = DATE '2026-06-11'
          WHERE "id" = 'booking-1'
        `),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "Booking_dates_consistent_with_guests",
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
